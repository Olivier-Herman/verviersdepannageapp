// src/lib/missions/processor.ts
// Logique centrale : reçoit un messageId Graph, récupère l'email,
// extrait, parse et insère dans Supabase. Appelé par le webhook uniquement.

import { createAdminClient }             from '@/lib/supabase'
import { detectSource, extractContent }  from './extractor'
import { parseMissionContent }           from './parser'
import { sendPushToRole }                from '@/lib/push'

const MISSIONS_EMAIL = process.env.MISSIONS_EMAIL! // assistance@verviersdepannage.be

// ── Graph helpers ─────────────────────────────────────────────────────────────

export async function getGraphToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type:    'client_credentials',
        scope:         'https://graph.microsoft.com/.default',
      })
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`Graph token error: ${data.error_description || data.error}`)
  return data.access_token
}

async function graphGet(token: string, path: string): Promise<any> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph GET ${res.status} ${path}: ${err.slice(0, 200)}`)
  }
  return res.json()
}

async function markAsRead(token: string, messageId: string): Promise<void> {
  await fetch(
    `https://graph.microsoft.com/v1.0/users/${MISSIONS_EMAIL}/messages/${messageId}`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isRead: true })
    }
  )
}

// ── Traitement d'un email ─────────────────────────────────────────────────────

export type ProcessResult =
  | { status: 'inserted';   missionId: string; externalId: string; source: string }
  | { status: 'duplicate';  externalId: string; source: string }
  | { status: 'skipped';    reason: string }
  | { status: 'error';      error: string; missionId?: string }

export async function processEmailMessage(messageId: string): Promise<ProcessResult> {
  const supabase = createAdminClient()

  // ── 0. Anti-doublon rapide sur source_email_id ──────────────────────────
  const { data: alreadyProcessed } = await supabase
    .from('incoming_missions')
    .select('id')
    .eq('source_email_id', messageId)
    .maybeSingle()

  if (alreadyProcessed) {
    return { status: 'duplicate', externalId: 'already_processed', source: 'unknown' }
  }

  // ── 1. Récupérer l'email complet depuis Graph ───────────────────────────
  let token: string
  try {
    token = await getGraphToken()
  } catch (e: any) {
    throw new Error(`Token Graph: ${e.message}`)
  }

  const message = await graphGet(
    token,
    `/users/${MISSIONS_EMAIL}/messages/${messageId}` +
    `?$select=id,subject,from,receivedDateTime,hasAttachments,body`
  )

  const fromEmail  = (message.from?.emailAddress?.address as string) || ''
  const subject    = (message.subject as string)                      || ''
  const receivedAt = (message.receivedDateTime as string)             || new Date().toISOString()

  // ── 2. Détecter la source ───────────────────────────────────────────────
  const source = detectSource(fromEmail, subject)

  if (source === 'unknown') {
    console.warn(`[Processor] Source inconnue — from: ${fromEmail} | subject: ${subject}`)
    await markAsRead(token, messageId)
    return { status: 'skipped', reason: `Source inconnue: ${fromEmail}` }
  }

  // ── 3. Récupérer pièces jointes si nécessaire ───────────────────────────
  let attachments: any[] = []
  if (message.hasAttachments) {
    const attData  = await graphGet(token, `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments`)
    attachments = attData.value || []
  }

  // ── 4. Extraire le contenu ──────────────────────────────────────────────
  const content = await extractContent(message, attachments, source)

  // ── 5. Parser avec Claude API ───────────────────────────────────────────
  let parsed
  try {
    parsed = await parseMissionContent(source, content, subject)
  } catch (parseErr: any) {
    console.error(`[Processor] Erreur parsing "${subject}":`, parseErr.message)

    // Stocker avec statut parse_error pour investigation manuelle
    const { data: errRow } = await supabase
      .from('incoming_missions')
      .insert({
        external_id:     `ERR_${Date.now()}_${messageId.slice(-8)}`,
        source,
        source_format:   content.sourceFormat,
        source_email_id: messageId,
        status:          'parse_error',
        raw_content:     content.rawContent.slice(0, 10000),
        received_at:     receivedAt,
      })
      .select('id')
      .single()

    if (errRow) {
      await supabase.from('mission_logs').insert({
        mission_id: errRow.id,
        action:     'error',
        notes:      parseErr.message,
        metadata:   { from: fromEmail, subject }
      })
    }

    await markAsRead(token, messageId)
    return { status: 'error', error: parseErr.message, missionId: errRow?.id }
  }

  // ── 6. Upsert en base (idempotent sur source + external_id) ────────────
  const { data: inserted, error: insertError } = await supabase
    .from('incoming_missions')
    .upsert(
      {
        external_id:          parsed.external_id,
        dossier_number:       parsed.dossier_number,
        source,
        source_format:        content.sourceFormat,
        source_email_id:      messageId,
        mission_type:         parsed.mission_type,
        incident_type:        parsed.incident_type,
        incident_description: parsed.incident_description,
        client_name:          parsed.client_name,
        client_phone:         parsed.client_phone,
        client_address:       parsed.client_address,
        vehicle_plate:        parsed.vehicle_plate,
        vehicle_brand:        parsed.vehicle_brand,
        vehicle_model:        parsed.vehicle_model,
        vehicle_vin:          parsed.vehicle_vin,
        vehicle_fuel:         parsed.vehicle_fuel,
        vehicle_gearbox:      parsed.vehicle_gearbox,
        incident_address:     parsed.incident_address,
        incident_city:        parsed.incident_city,
        incident_country:     parsed.incident_country || 'BE',
        destination_name:     parsed.destination_name,
        destination_address:  parsed.destination_address,
        amount_guaranteed:    parsed.amount_guaranteed,
        incident_at:          parsed.incident_at,
        received_at:          receivedAt,
        status:               'new',
        dispatch_mode:        'manual',
        raw_content:          content.rawContent.slice(0, 10000),
        parsed_data:          parsed,
        parse_confidence:     parsed.confidence,
      },
      { onConflict: 'source,external_id', ignoreDuplicates: true }
    )
    .select('id')
    .single()

  await markAsRead(token, messageId)

  if (insertError) {
    if (insertError.code === '23505') {
      // Doublon sur (source, external_id) — mission déjà reçue via autre email
      return { status: 'duplicate', externalId: parsed.external_id, source }
    }
    return { status: 'error', error: insertError.message }
  }

  if (!inserted) {
    return { status: 'duplicate', externalId: parsed.external_id, source }
  }

  // ── 7. Log de réception ─────────────────────────────────────────────────
  await supabase.from('mission_logs').insert({
    mission_id: inserted.id,
    action:     'received',
    notes:      `Reçu de ${source.toUpperCase()} — ${subject}`,
    metadata:   { source_email_id: messageId, confidence: parsed.confidence, from: fromEmail }
  })

  // ── 8. Push notification dispatchers ────────────────────────────────────
  const typeLabel = parsed.mission_type === 'remorquage' ? '🚛 Remorquage'
                  : parsed.mission_type === 'depannage'  ? '🔧 Dépannage'
                  : parsed.mission_type === 'transport'  ? '🚐 Transport'
                  : '📋 Mission'

  const vehicleLabel = [parsed.vehicle_brand, parsed.vehicle_model, parsed.vehicle_plate]
    .filter(Boolean).join(' ')

  await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
    title: `${typeLabel} — ${source.toUpperCase()}`,
    body:  vehicleLabel || parsed.client_name || 'Nouvelle mission reçue',
    url:   '/dispatch',
    tag:   `mission-${inserted.id}`,
    icon:  '/icons/apple-touch-icon.png'
  })

  console.log(`[Processor] ✓ Mission insérée: ${source}/${parsed.external_id} (conf: ${parsed.confidence})`)
  return { status: 'inserted', missionId: inserted.id, externalId: parsed.external_id, source }
}
