// src/app/api/cron/poll-missions/route.ts
// Polling de secours — lit les emails non lus et délègue à processEmailMessage
// pour avoir exactement la même logique que le webhook (MIME fallback inclus)

import { NextResponse }          from 'next/server'
import { getGraphToken, processEmailMessage } from '@/lib/missions/processor'

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

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, number> = { new: 0, duplicate: 0, skipped: 0, error: 0 }

  try {
    const token = await getGraphToken()

    const messagesData = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/mailFolders/inbox/messages` +
      `?$filter=isRead eq false` +
      `&$top=${MAX_MESSAGES}` +
      `&$select=id,subject,receivedDateTime` +
      `&$orderby=receivedDateTime asc`
    )

    const messages: any[] = messagesData.value || []
    console.log(`[PollMissions] ${messages.length} message(s) non lu(s)`)

    // Traiter séquentiellement pour éviter les conflits sur source_email_id
    for (const message of messages) {
      try {
        const result = await processEmailMessage(message.id)
        results[result.status] = (results[result.status] || 0) + 1
        if (result.status === 'inserted') results.new++
        console.log(`[PollMissions] ${message.id.slice(-8)} → ${result.status}`)
      } catch (err: any) {
        console.error(`[PollMissions] Erreur message ${message.id.slice(-8)}:`, err.message)
        results.error++
      }
    }

    return NextResponse.json({ ok: true, ...results })

  } catch (err: any) {
    console.error('[PollMissions] Erreur fatale:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
