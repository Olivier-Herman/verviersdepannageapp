// src/app/api/cron/poll-missions/route.ts
// maxDuration 60s : poll boucle sur jusqu'à 25 messages, chacun pouvant prendre
// 15-30s en parsing IA. Si fanout important, traite seulement N premiers.
export const maxDuration = 60
export const dynamic    = 'force-dynamic'

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
  // Protection : seul Vercel cron (avec CRON_SECRET) peut declencher ce endpoint.
  // Sinon n'importe quel service externe (ex: cron-job.org) peut le marteler.
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, number> = { new: 0, duplicate: 0, skipped: 0, error: 0, inserted: 0 }

  try {
    const token = await getGraphToken()

    // Lire les derniers emails (lus OU non lus) — la dédup se fait via source_email_id
    const messagesData = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/mailFolders/inbox/messages` +
      `?$top=${MAX_MESSAGES}` +
      `&$select=id,subject,receivedDateTime,isRead` +
      `&$orderby=receivedDateTime desc`
    )

    const messages: any[] = messagesData.value || []
    console.log(`[PollMissions] ${messages.length} message(s) récupéré(s)`)

    for (const message of messages) {
      try {
        const result = await processEmailMessage(message.id)
        results[result.status] = (results[result.status] || 0) + 1
        if (result.status === 'inserted') results.inserted++
      } catch (err: any) {
        console.error(`[PollMissions] Erreur:`, err.message)
        results.error++
      }
    }

    results.new = results.inserted
    return NextResponse.json({ ok: true, ...results })

  } catch (err: any) {
    console.error('[PollMissions] Erreur fatale:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
