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
 * Récupère les pièces jointes avec contentBytes.
 * Retourne [] si /attachments 404 OU si aucun contentBytes n'est présent
 * (le caller utilisera alors le fallback MIME $value).
 */
async function getAttachmentsWithContent(token: string, messageId: string): Promise<any[]> {
  // 1. Lister les pièces jointes
  let meta: any[] = []
  try {
    const listing = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments?$select=id,name,contentType,size`
    )
    meta = listing.value || []
  } catch {
    console.warn('[Processor] /attachments 404 → MIME fallback')
    return []
  }

  if (!meta.length) return []

  console.log(`[Processor] ${meta.length} pièce(s) jointe(s):`,
    meta.map((a: any) => `${a.name} (${a.size}b)`).join(', ')
  )

  // 2. Fetcher chaque pièce jointe individuellement pour avoir contentBytes
  const attachments = await Promise.all(
    meta.map(async (att: any) => {
      try {
        const full = await graphGet(
          token,
          `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments/${att.id}`
        )
        if (full.contentBytes) {
          console.log(`[Processor] contentBytes OK: ${att.name} (${full.contentBytes.length} chars base64)`)
        } else {
          console.warn(`[Processor] contentBytes ABSENT pour ${att.name} — sera ignoré`)
        }
        return full
      } catch (e: any) {
        console.warn(`[Processor] Erreur fetch pièce jointe ${att.name}:`, e.message)
        return att
      }
    })
  )

  // 3. Vérifier qu'au moins une pièce jointe a contentBytes
  const hasContent = attachments.some(a => a.contentBytes && a.contentBytes.length > 0)
  if (!hasContent) {
    console.warn('[Processor] Aucun contentBytes dans les pièces jointes → MIME fallback')
    return []
  }

  return attachments
}

/**
 * Fallback MIME : récupère le message brut via /$value et extrait les pièces jointes.
 */
async function getAttachmentsFromMime(token: string, messageId: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${MISSIONS_EMAIL}/messages/${messageId}/$value`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      console.warn(`[Processor] MIME $value ${res.status}`)
      return []
    }
    const mimeRaw = await res.text()
    console.log(`[Processor] MIME brut: ${mimeRaw.length} chars`)
    return parseMimeAttachments(mimeRaw)
  } catch (e: any) {
    console.error('[Processor] Erreur MIME $value:', e.message)
    return []
  }
}

/**
 * Parse les pièces jointes depuis un MIME multipart brut.
 */
function parseMimeAttachments(mime: string): any[] {
  const attachments: any[] = []

  const boundaryMatch = mime.match(/boundary="?([^"\r\n;]+)"?/i)
  if (!boundaryMatch) {
    console.warn('[Processor] Pas de boundary MIME')
    return []
  }

  const boundary = boundaryMatch[1].trim()
  const parts    = mime.split(`--${boundary}`)

  for (const part of parts) {
    if (part.trim() === '' || part.trim() === '--') continue

    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue

    const headers = part.substring(0, headerEnd).toLowerCase()
    const body    = part.substring(headerEnd + 4)

    if (!headers.includes('content-disposition') || !headers.includes('attachment')) continue

    const nameMatch   = part.match(/filename=["']?([^"'\r\n;]+)["']?/i)
    const name        = nameMatch?.[1]?.trim() || 'attachment'
    const ctMatch     = part.match(/content-type:\s*([^\r\n;]+)/i)
    const contentType = ctMatch?.[1]?.trim() || 'application/octet-stream'
    const encMatch    = part.match(/content-transfer-encoding:\s*([^\r\n]+)/i)
    const encoding    = encMatch?.[1]?.trim().toLowerCase() || 'base64'

    // Nettoyer le contenu (supprimer le boundary de fin)
    const rawContent  = body.replace(/[\r\n]--[\s\S]*$/, '').trim()

    let contentBytes: string
    if (encoding === 'base64') {
      contentBytes = rawContent.replace(/\s/g, '')
    } else {
      contentBytes = Buffer.from(rawContent, encoding as BufferEncoding).toString('base64')
    }

    console.log(`[Processor] Pièce jointe MIME: ${name} (${contentType}) ${contentBytes.length} chars`)
    attachments.push({ name, contentType, contentBytes })
  }

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

  // 0. Anti-doublon atomique
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

    const source = await detectSource(fromEmail, subject)

    // Récupérer les pièces jointes avec contentBytes
    let attachments: any[] = []
    if (message.hasAttachments) {
      attachments = await getAttachmentsWithContent(token, messageId)

      // Fallback MIME si aucun contentBytes disponible
      if (attachments.length === 0) {
        console.log('[Processor] Fallback MIME $value...')
        attachments = await getAttachmentsFromMime(token, messageId)
      }
    }

    const content = await extractContent(message, attachments, source)
    console.log(`[Processor] Contenu: format=${content.sourceFormat} longueur=${content.textContent.length}`)

    // Source inconnue → stocker + notifier
    if (source === 'unknown') {
      console.warn(`[Processor] Source inconnue: ${fromEmail}`)
      if (placeholderId) {
        await supabase.from('incoming_missions').update({
          external_id:   `UNKNOWN_SENDER_${Date.now()}`,
          source:        'unknown',
          source_format: content.sourceFormat,
          status:        'new',
          raw_content:   content.rawContent.slice(0, 10000),
          received_at:   receivedAt,
        }).eq('id', placeholderId)
      }
      await sendPushToRole(['admin', 'superadmin'], {
        title: '⚠️ Expéditeur inconnu',
        body:  `Email de ${fromEmail} — à identifier dans les paramètres`,
        url:   '/admin/settings',
        tag:   `unknown-sender-${fromEmail}`,
        icon:  '/icons/apple-touch-icon.png'
      })
      await markAsRead(token, messageId)
      return { status: 'skipped', reason: `Source inconnue stockée: ${fromEmail}` }
    }

    // Contenu vide → skip
    if (!content.textContent && !content.pdfBase64) {
      console.warn(`[Processor] Contenu vide pour ${source}`)
      if (placeholderId) await supabase.from('incoming_missions').delete().eq('id', placeholderId)
      await markAsRead(token, messageId)
      return { status: 'skipped', reason: `Contenu vide (source: ${source})` }
    }

    // Parser avec Claude
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

    // Mettre à jour le placeholder
    await supabase.from('incoming_missions').update({
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
    }).eq('id', placeholderId!)

    await markAsRead(token, messageId)

    await supabase.from('mission_logs').insert({
      mission_id: placeholderId!,
      action:     'received',
      notes:      `Reçu de ${source.toUpperCase()} — ${subject}`,
      metadata:   { source_email_id: messageId, confidence: parsed.confidence, from: fromEmail }
    })

    const typeLabel    = parsed.mission_type === 'remorquage' ? '🚛 Remorquage'
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
