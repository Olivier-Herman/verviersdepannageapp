// src/app/api/cron/poll-missions/route.ts
// Polling de la boîte assistance@verviersdepannage.be via Microsoft Graph API
// Détecte, parse et insère les nouvelles missions dans Supabase
// Notifie les dispatchers via push si nouvelles missions

import { NextResponse }          from 'next/server'
import { createAdminClient }     from '@/lib/supabase'
import { detectSource, extractContent } from '@/lib/missions/extractor'
import { parseMissionContent }   from '@/lib/missions/parser'
import { sendPushToRole }        from '@/lib/push'

const MISSIONS_EMAIL = process.env.MISSIONS_EMAIL!   // assistance@verviersdepannage.be
const MAX_MESSAGES   = 25

// ── Helpers Graph API ────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
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
    throw new Error(`Graph GET error ${res.status} on ${path}: ${err.slice(0, 200)}`)
  }
  return res.json()
}

async function markAsRead(token: string, messageId: string): Promise<void> {
  await fetch(
    `https://graph.microsoft.com/v1.0/users/${MISSIONS_EMAIL}/messages/${messageId}`,
    {
      method:  'PATCH',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ isRead: true })
    }
  )
}

// ── Handler principal ────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Vercel crons appellent sans Authorization header
  // Si un header est présent (appel externe), vérifier le secret
  const authHeader = req.headers.get('authorization')
  if (authHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const processed: string[] = []
  const skipped:   string[] = []
  const errors:    string[] = []
  let   newMissions = 0

  try {
    const token = await getToken()

    // Récupérer les messages non lus (corps inclus dans la requête initiale)
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
      const subject    = (message.subject as string)                       || ''
      const receivedAt = (message.receivedDateTime as string)              || new Date().toISOString()

      try {
        // ── 1. Vérifier si déjà traité (source_email_id) ──────────────
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

        // ── 2. Détecter la source ──────────────────────────────────────
        const source = detectSource(fromEmail, subject)

        if (source === 'unknown') {
          console.warn(`[PollMissions] Source inconnue: from="${fromEmail}" subject="${subject}"`)
          await markAsRead(token, messageId)
          skipped.push(subject)
          continue
        }

        // ── 3. Récupérer les pièces jointes si nécessaire ─────────────
        let attachments: any[] = []
        if (message.hasAttachments) {
          const attData = await graphGet(
            token,
            `/users/${MISSIONS_EMAIL}/messages/${messageId}/attachments`
          )
          attachments = attData.value || []
        }

        // ── 4. Extraire le contenu ────────────────────────────────────
        const content = await extractContent(message, attachments, source)

        // ── 5. Parser avec Claude API ─────────────────────────────────
        let parsed
        try {
          parsed = await parseMissionContent(source, content, subject)
        } catch (parseErr: any) {
          console.error(`[PollMissions] Erreur parsing "${subject}":`, parseErr.message)

          // Stocker avec statut parse_error pour investigation manuelle
          await supabase.from('incoming_missions').insert({
            external_id:      `ERR_${Date.now()}_${messageId.slice(-8)}`,
            source,
            source_format:    content.sourceFormat,
            source_email_id:  messageId,
            status:           'parse_error',
            raw_content:      content.rawContent.slice(0, 10000),
            received_at:      receivedAt,
          })

          await markAsRead(token, messageId)
          errors.push(subject)
          continue
        }

        // ── 6. Upsert en base (idempotent sur source + external_id) ──
        const { data: inserted, error: insertError } = await supabase
          .from('incoming_missions')
          .upsert(
            {
              external_id:         parsed.external_id,
              dossier_number:      parsed.dossier_number,
              source,
              source_format:       content.sourceFormat,
              source_email_id:     messageId,
              mission_type:        parsed.mission_type,
              incident_type:       parsed.incident_type,
              incident_description: parsed.incident_description,
              client_name:         parsed.client_name,
              client_phone:        parsed.client_phone,
              client_address:      parsed.client_address,
              vehicle_plate:       parsed.vehicle_plate,
              vehicle_brand:       parsed.vehicle_brand,
              vehicle_model:       parsed.vehicle_model,
              vehicle_vin:         parsed.vehicle_vin,
              vehicle_fuel:        parsed.vehicle_fuel,
              vehicle_gearbox:     parsed.vehicle_gearbox,
              incident_address:    parsed.incident_address,
              incident_city:       parsed.incident_city,
              incident_country:    parsed.incident_country || 'BE',
              destination_name:    parsed.destination_name,
              destination_address: parsed.destination_address,
              amount_guaranteed:   parsed.amount_guaranteed,
              incident_at:         parsed.incident_at,
              received_at:         receivedAt,
              status:              'new',
              dispatch_mode:       'manual',
              raw_content:         content.rawContent.slice(0, 10000),
              parsed_data:         parsed,
              parse_confidence:    parsed.confidence,
            },
            {
              onConflict:       'source,external_id',
              ignoreDuplicates: true
            }
          )
          .select('id')
          .single()

        if (insertError) {
          // Conflit = doublon sur (source, external_id) → mission déjà reçue via autre email
          if (insertError.code === '23505') {
            console.log(`[PollMissions] Doublon ignoré: ${source}/${parsed.external_id}`)
            skipped.push(parsed.external_id)
          } else {
            console.error('[PollMissions] Insert error:', insertError)
            errors.push(parsed.external_id)
          }
        } else if (inserted) {
          // ── 7. Log de réception ──────────────────────────────────
          await supabase.from('mission_logs').insert({
            mission_id: inserted.id,
            action:     'received',
            notes:      `Reçu de ${source.toUpperCase()} — ${subject}`,
            metadata:   {
              source_email_id: messageId,
              confidence:      parsed.confidence,
              from:            fromEmail
            }
          })

          processed.push(parsed.external_id)
          newMissions++
          console.log(`[PollMissions] ✓ ${source}/${parsed.external_id} (conf: ${parsed.confidence})`)
        }

        await markAsRead(token, messageId)

      } catch (msgErr: any) {
        console.error(`[PollMissions] Erreur message "${subject}":`, msgErr.message)
        errors.push(subject || messageId)
        // Marquer quand même comme lu pour éviter une boucle infinie
        try { await markAsRead(token, messageId) } catch { /* ignore */ }
      }
    }

    // ── 8. Push notification si nouvelles missions ─────────────────────
    if (newMissions > 0) {
      const plural = newMissions > 1
      await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
        title: `${newMissions} nouvelle${plural ? 's' : ''} mission${plural ? 's' : ''}`,
        body:  `${newMissions} mission${plural ? 's' : ''} en attente de dispatch`,
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
      processed,
      ...(errors.length > 0 && { error_details: errors })
    })

  } catch (err: any) {
    console.error('[PollMissions] Erreur fatale:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
