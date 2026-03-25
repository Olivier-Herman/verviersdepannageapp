// src/app/api/cron/poll-missions/route.ts
// Polling de secours — lit les emails non lus comme fallback au webhook

import { NextResponse }                 from 'next/server'
import { createAdminClient }            from '@/lib/supabase'
import { detectSource, extractContent } from '@/lib/missions/extractor'
import { parseMissionContent }          from '@/lib/missions/parser'
import { sendPushToRole }               from '@/lib/push'
import { getGraphToken }                from '@/lib/missions/processor'

const MISSIONS_EMAIL = process.env.MISSIONS_EMAIL!
const MAX_MESSAGES   = 25

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
 * Récupère les pièces jointes avec contenu — retourne [] si 404
 */
async function getAttachmentsWithContent(token: string, messageId: string): Promise<any[]> {
  let meta: any[] = []
  try {
    const listing = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments?$select=id,name,contentType,size`
    )
    meta = listing.value || []
  } catch {
    console.warn(`[PollMissions] Attachments 404 — fallback body`)
    return []
  }

  return Promise.all(
    meta.map(async (att: any) => {
      try {
        return await graphGet(token, `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments/${att.id}`)
      } catch {
        return att
      }
    })
  )
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase   = createAdminClient()
  const processed: string[] = []
  const skipped:   string[] = []
  const errors:    string[] = []
  const unknown:   string[] = []
  let   newMissions = 0

  try {
    const token = await getGraphToken()

    const messagesData = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/mailFolders/inbox/messages` +
      `?$filter=isRead eq false` +
      `&$top=${MAX_MESSAGES}` +
      `&$select=id,subject,from,receivedDateTime,hasAttachments,body` +
      `&$orderby=receivedDateTime asc`
    )

    const messages: any[] = messagesData.value || []
    console.log(`[PollMissions] ${messages.length} message(s) non lu(s)`)

    for (const message of messages) {
      const messageId  = message.id as string
      const fromEmail  = (message.from?.emailAddress?.address as string) || ''
      const subject    = (message.subject as string)                      || ''
      const receivedAt = (message.receivedDateTime as string)             || new Date().toISOString()

      try {
        // Anti-doublon
        const { data: existing } = await supabase
          .from('incoming_missions')
          .select('id')
          .eq('source_email_id', messageId)
          .maybeSingle()

        if (existing) {
          await markAsRead(token, messageId)
          skipped.push(subject)
          continue
        }

        // Détecter la source
        const source = await detectSource(fromEmail, subject)

        // Pièces jointes — 404 géré
        let attachments: any[] = []
        if (message.hasAttachments) {
          attachments = await getAttachmentsWithContent(token, messageId)
        }

        // Extraire le contenu
        const content = await extractContent(message, attachments, source)

        // Source inconnue → stocker + notifier admin
        if (source === 'unknown') {
          console.warn(`[PollMissions] Source inconnue: from="${fromEmail}"`)

          await supabase.from('incoming_missions').insert({
            external_id:     `UNKNOWN_SENDER_${Date.now()}`,
            source:          'unknown',
            source_format:   content.sourceFormat,
            source_email_id: messageId,
            status:          'new',
            raw_content:     content.rawContent.slice(0, 10000),
            received_at:     receivedAt,
          })

          await sendPushToRole(['admin', 'superadmin'], {
            title: '⚠️ Expéditeur inconnu',
            body:  `Email de ${fromEmail} — à identifier dans les paramètres`,
            url:   '/admin/settings',
            tag:   `unknown-sender-${fromEmail}`,
            icon:  '/icons/apple-touch-icon.png'
          })

          await markAsRead(token, messageId)
          unknown.push(fromEmail)
          continue
        }

        // Contenu vide → skip silencieux
        if (!content.textContent && !content.pdfBase64) {
          await markAsRead(token, messageId)
          skipped.push(subject)
          continue
        }

        // Parser avec Claude
        let parsed
        try {
          parsed = await parseMissionContent(source, content, subject)
        } catch (parseErr: any) {
          console.error(`[PollMissions] Erreur parsing "${subject}":`, parseErr.message)
          await supabase.from('incoming_missions').insert({
            external_id:     `ERR_${Date.now()}_${messageId.slice(-8)}`,
            source,
            source_format:   content.sourceFormat,
            source_email_id: messageId,
            status:          'parse_error',
            raw_content:     content.rawContent.slice(0, 10000),
            received_at:     receivedAt,
          })
          await markAsRead(token, messageId)
          errors.push(subject)
          continue
        }

        // Upsert
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

        if (insertError) {
          if (insertError.code !== '23505') errors.push(parsed.external_id)
          else skipped.push(parsed.external_id)
        } else if (inserted) {
          await supabase.from('mission_logs').insert({
            mission_id: inserted.id,
            action:     'received',
            notes:      `Poll — ${source.toUpperCase()} — ${subject}`,
            metadata:   { source_email_id: messageId, confidence: parsed.confidence }
          })
          processed.push(parsed.external_id)
          newMissions++
        }

        await markAsRead(token, messageId)

      } catch (msgErr: any) {
        console.error(`[PollMissions] Erreur "${subject}":`, msgErr.message)
        errors.push(subject || messageId)
        try { await markAsRead(token, messageId) } catch { /* ignore */ }
      }
    }

    if (newMissions > 0) {
      await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
        title: `${newMissions} nouvelle${newMissions > 1 ? 's' : ''} mission${newMissions > 1 ? 's' : ''}`,
        body:  `${newMissions} mission${newMissions > 1 ? 's' : ''} en attente de dispatch`,
        url:   '/dispatch',
        tag:   'new-missions',
        icon:  '/icons/apple-touch-icon.png'
      })
    }

    return NextResponse.json({
      ok:        true,
      new:       newMissions,
      skipped:   skipped.length,
      errors:    errors.length,
      unknown:   unknown.length,
      processed,
      ...(unknown.length > 0 && { unknown_senders: unknown })
    })

  } catch (err: any) {
    console.error('[PollMissions] Erreur fatale:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
