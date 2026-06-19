// src/app/api/cron/poll-missions/route.ts
// maxDuration 60s : poll boucle sur jusqu'à 25 messages, chacun pouvant prendre
// 15-30s en parsing IA. Si fanout important, traite seulement N premiers.
export const maxDuration = 60
export const dynamic    = 'force-dynamic'

import { NextResponse }          from 'next/server'
import { getGraphToken, processEmailMessage } from '@/lib/missions/processor'

const MISSIONS_EMAIL = process.env.MISSIONS_EMAIL!
const MAX_MESSAGES   = 200   // Olivier 2026-06-19 : élargi TEMPORAIREMENT pour rattraper le remorquage Touring 2026BX244888 sorti de la fenêtre (à remettre à 25 après)

// Categorie Outlook posee par le processor sur les emails traites (succes
// ou skip definitif). Au prochain poll, on ignore les emails qui ont deja
// cette categorie -> indempotent et resistant a la suppression manuelle
// des missions en DB.
const PROCESSED_CATEGORY = 'VD Soft - Mission traitée'

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

/**
 * Ajoute la categorie PROCESSED_CATEGORY a l email (PATCH Outlook).
 * On preserve les categories existantes. Best-effort.
 */
async function tagEmailAsProcessed(token: string, messageId: string, existingCategories: string[]): Promise<void> {
  if (existingCategories.includes(PROCESSED_CATEGORY)) return
  const newCategories = [...existingCategories, PROCESSED_CATEGORY]
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${MISSIONS_EMAIL}/messages/${messageId}`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ categories: newCategories }),
    }
  )
  if (!res.ok) {
    const err = await res.text()
    console.warn(`[PollMissions] tag email ${messageId} fail:`, res.status, err.slice(0, 200))
  }
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

    // Lire les derniers emails (lus OU non lus). Dedup principale via
    // source_email_id en DB + dedup defensive via categorie Outlook
    // (PROCESSED_CATEGORY) pour resister a la suppression manuelle
    // des missions en DB.
    const messagesData = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/mailFolders/inbox/messages` +
      `?$top=${MAX_MESSAGES}` +
      `&$select=id,subject,receivedDateTime,isRead,categories` +
      `&$orderby=receivedDateTime desc`
    )

    const messages: any[] = messagesData.value || []
    console.log(`[PollMissions] ${messages.length} message(s) récupéré(s)`)

    for (const message of messages) {
      // Skip si l email a deja la categorie "traite" (defensive : empeche
      // le re-parse meme si la mission a ete supprimee/cancelled en DB).
      if (Array.isArray(message.categories) && message.categories.includes(PROCESSED_CATEGORY)) {
        results.skipped++
        continue
      }
      try {
        const result = await processEmailMessage(message.id)
        results[result.status] = (results[result.status] || 0) + 1
        if (result.status === 'inserted') results.inserted++

        // Tag l email avec la categorie "traite" si le processing s est
        // bien passe (inserted ou duplicate). Best-effort : si l ajout
        // de categorie echoue, on ignore (la dedup DB prend le relais).
        if (result.status === 'inserted' || result.status === 'duplicate' || result.status === 'skipped') {
          await tagEmailAsProcessed(token, message.id, message.categories || []).catch(() => {})
        }
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
