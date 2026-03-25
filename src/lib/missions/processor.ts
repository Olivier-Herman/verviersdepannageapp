// src/lib/missions/processor.ts

import { createAdminClient }            from '@/lib/supabase'
import { detectSource, extractContent } from './extractor'
import { parseMissionContent }          from './parser'
import { sendPushToRole }               from '@/lib/push'

const MISSIONS_EMAIL = process.env.MISSIONS_EMAIL!

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
  if (!res.ok) throw new Error(`Graph token: ${data.error_description || data.error}`)
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

/**
 * Récupère les pièces jointes avec leur contenu complet.
 * Graph ne retourne PAS contentBytes dans le listing /attachments —
 * il faut fetcher chaque pièce jointe individuellement via /attachments/{id}
 */
async function getAttachmentsWithContent(token: string, messageId: string): Promise<any[]> {
  // D'abord, lister les pièces jointes (sans contentBytes)
  const listing = await graphGet(
    token,
    `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments` +
    `?$select=id,name,contentType,size`
  )

  const attachmentMeta: any[] = listing.value || []
  console.log(`[Processor] ${attachmentMeta.length} pièce(s) jointe(s) trouvée(s):`,
    attachmentMeta.map(a => `${a.name} (${a.contentType}, ${a.size} bytes)`).join(', ')
  )

  // Fetcher chaque pièce jointe individuellement pour avoir contentBytes
  const attachments = await Promise.all(
    attachmentMeta.map(async (att) => {
      try {
        const full = await graphGet(
          token,
          `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments/${att.id}`
        )
        console.log(`[Processor] Pièce jointe fetchée: ${full.name}, contentBytes: ${full.contentBytes ? full.contentBytes.length + ' chars' : 'VIDE'}`)
        return full
      } catch (e: any) {
        console.error(`[Processor] Erreur fetch pièce jointe ${att.name}:`, e.message)
        return att
      }
    })
  )

  return attachments
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProcessResult =
  | { status: 'inserted';  missionId: string; externalId: string; source: string }
  | { status: 'duplicate'; externalId: string; source: string }
  | { status: 'skipped';   reason: string }
  | { status: 'error';     error: string; missionId?: string }

// ── Traitement d'un email ─────────────────────────────────────────────────────

export async function processEmailMessage(messageId: string): Promise<ProcessResult> {
  const supabase = createAdminClient()

  // 0. Anti-doublon atomique via source_email_id UNIQUE
  const { error: lockError } = await supabase
    .from('incoming_missions')
    .insert({
      external_id:     `PROCESSING_${messageId.slice(-16)}`,
      source:          'unknown',
      source_format:   'unknown',
      source_email_id: messageId,
      status:          'new',
      received_at:     new Date().toISOString(),
    })

  if (lockError) {
    if (lockError.code === '23505') {
      console.log(`[Processor] Doublon ignoré: ${messageId.slice(-8)}`)
      return { status: 'duplicate', externalId: 'already_processing', source: 'unknown' }
    }
    console.warn('[Processor] Lock warning:', lockError.message)
  }

  const { data: placeholder } = await supabase
    .from('incoming_missions')
    .select('id')
    .eq('source_email_id', messageId)
    .maybeSingle()

  const placeholderId = placeholder?.id

  try {
    // 1. Récupérer l'email depuis Graph
    const token   = await getGraphToken()
    const message = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/messages/${messageId}` +
      `?$select=id,subject,from,receivedDateTime,hasAttachments,body`
    )

    const fromEmail  = (message.from?.emailAddress?.address as string) || ''
    const subject    = (message.subject as string)                      || ''
    const receivedAt = (message.receivedDateTime as string)             || new Date().toISOString()

    console.log(`[Processor] Email: from="${fromEmail}" subject="${subject}" hasAttachments=${message.hasAttachments}`)

    // 2. Détecter la source
    const source = await detectSource(fromEmail, subject)

    if (source === 'unknown') {
      console.warn(`[Processor] Source inconnue — from: ${fromEmail}`)
      if (placeholderId) await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      await markAsRead(token, messageId)
      return { status: 'skipped', reason: `Source inconnue: ${fromEmail}` }
    }

    // 3. Pièces jointes — fetch individuel pour avoir contentBytes
    let attachments: any[] = []
    if (message.hasAttachments) {
      attachments = await getAttachmentsWithContent(token, messageId)
    }

    // 4. Extraire le contenu
    const content = await extractContent(message, attachments, source)

    console.log(`[Processor] Contenu extrait: format=${content.sourceFormat} longueur=${content.textContent.length} chars`)

    if (!content.textContent && !content.pdfBase64) {
      console.warn(`[Processor] Contenu vide pour ${source}`)
      if (placeholderId) await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      await markAsRead(token, messageId)
      return { status: 'skipped', reason: `Contenu vide (source: ${source})` }
    }

    // 5. Parser avec Claude API
    let parsed
    try {
      parsed = await parseMissionContent(source, content, subject)
    } catch (parseErr: any) {
      console.error(`[Processor] Erreur parsing:`, parseErr.message)

      if (placeholderId) {
        await supabase.from('incoming_missions').update({
          external_id:   `ERR_${Date.now()}_${messageId.slice(-8)}`,
          source,
          source_format: content.sourceFormat,
          status:        'parse_error',
          raw_content:   content.rawContent.slice(0, 10000),
          received_at:   receivedAt,
        }).eq('id', placeholderId)

        await supabase.from('mission_logs').insert({
          mission_id: placeholderId,
          action:     'error',
          notes:      parseErr.message,
          metadata:   { from: fromEmail, subject }
        })
      }

      await markAsRead(token, messageId)
      return { status: 'error', error: parseErr.message, missionId: placeholderId }
    }

    // 6. Mettre à jour le placeholder
    const { error: updateError } = await supabase
      .from('incoming_missions')
      .update({
        external_id:          parsed.external_id,
        dossier_number:       parsed.dossier_number,
        source,
        source_format:        content.sourceFormat,
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
      })
      .eq('id', placeholderId!)

    await markAsRead(token, messageId)

    if (updateError) {
      return { status: 'error', error: updateError.message }
    }

    // 7. Log
    await supabase.from('mission_logs').insert({
      mission_id: placeholderId!,
      action:     'received',
      notes:      `Reçu de ${source.toUpperCase()} — ${subject}`,
      metadata:   { source_email_id: messageId, confidence: parsed.confidence, from: fromEmail }
    })

    // 8. Push
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
      tag:   `mission-${placeholderId}`,
      icon:  '/icons/apple-touch-icon.png'
    })

    console.log(`[Processor] ✓ ${source}/${parsed.external_id} (conf: ${parsed.confidence})`)
    return { status: 'inserted', missionId: placeholderId!, externalId: parsed.external_id, source }

  } catch (err: any) {
    console.error('[Processor] Erreur inattendue:', err.message)
    if (placeholderId) {
      await supabase.from('incoming_missions').update({
        status:      'parse_error',
        raw_content: `Erreur: ${err.message}`.slice(0, 10000),
      }).eq('id', placeholderId)
    }
    return { status: 'error', error: err.message, missionId: placeholderId }
  }
}
