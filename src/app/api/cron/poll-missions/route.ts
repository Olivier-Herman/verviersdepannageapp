// src/app/api/cron/poll-missions/route.ts
export const maxDuration = 60

import { NextResponse }          from 'next/server'
import { getGraphToken, processEmailMessage } from '@/lib/missions/processor'

const MISSIONS_EMAIL = process.env.MISSIONS_EMAIL!
const MAX_MESSAGES   = 10

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
  // Pas d'auth — cron-job.org appelle directement
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

    for (const message of messages) {
      try {
        const result = await processEmailMessage(message.id)
        results[result.status] = (results[result.status] || 0) + 1
        if (result.status === 'inserted') results.new++
      } catch (err: any) {
        console.error(`[PollMissions] Erreur:`, err.message)
        results.error++
      }
    }

    return NextResponse.json({ ok: true, ...results })

  } catch (err: any) {
    console.error('[PollMissions] Erreur fatale:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
