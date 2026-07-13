// src/app/api/cron/poll-missions/route.ts
//
// Poll des emails entrants (boîte MISSIONS_EMAIL) → création des fiches mission.
//
// FIABILITÉ (Olivier 2026-07-13) : avant, on lisait les 25 emails LES PLUS RÉCENTS
// (dont les déjà-traités qui occupaient des slots) puis on parsait du + récent au
// + ancien. Comme chaque parse prend 15-30 s et que la fonction est coupée, en
// rafale — ou pour un mail LIVRÉ EN RETARD (receivedDateTime ancien → classé
// profond) — la fiche était reléguée hors fenêtre et JAMAIS traitée (des IMA par
// mail « n'arrivaient pas »). Correctif :
//   1. On ne récupère QUE les emails NON TRAITÉS (filtre serveur sur l'absence de
//      catégorie ; repli = scan paginé si Graph refuse le filtre avancé).
//   2. On les traite du PLUS ANCIEN au plus récent (FIFO → plus de famine).
//   3. Budget temps pour ne pas se faire couper au milieu d'un parse.
export const maxDuration = 120
export const dynamic    = 'force-dynamic'

import { NextResponse }          from 'next/server'
import { getGraphToken, processEmailMessage } from '@/lib/missions/processor'

const MISSIONS_EMAIL = process.env.MISSIONS_EMAIL!
const PAGE_SIZE      = 50       // taille de page (métadonnées, peu coûteux)
const MAX_SCAN_PAGES = 6        // repli : jusqu'à 300 mails scannés pour trouver les non-traités
const MAX_UNTAGGED   = 60       // plafond d'emails non-traités collectés par run
const MAX_PROCESS    = 20       // plafond de sécurité (le vrai frein reste le temps)
const TIME_BUDGET_MS = 110_000  // marge sous maxDuration (120 s) : on arrête d'entamer un parse après

// Categorie Outlook posee par le processor sur les emails traites (succes
// ou skip definitif). On ne collecte QUE les emails qui n'ont PAS cette
// categorie -> indempotent et resistant a la suppression manuelle des missions.
const PROCESSED_CATEGORY = 'VD Soft - Mission traitée'

async function graphGet(token: string, path: string, extraHeaders?: Record<string, string>): Promise<any> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...(extraHeaders || {}) }
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph GET ${res.status} ${path.slice(0, 80)}: ${err.slice(0, 200)}`)
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

type Msg = { id: string; receivedDateTime: string; categories: string[] }

/**
 * Récupère les emails NON TRAITÉS de l'inbox (ceux sans la catégorie
 * PROCESSED_CATEGORY), indépendamment de leur position temporelle — pour ne
 * PAS rater un mail livré en retard (receivedDateTime ancien).
 *   - Chemin principal : filtre serveur Graph (`not categories/any(...)`,
 *     requête avancée → header ConsistencyLevel + $count).
 *   - Repli : si Graph refuse le filtre avancé, scan paginé décroissant et
 *     collecte côté code des mails non taggés.
 */
async function collectUntagged(token: string): Promise<Msg[]> {
  const select = '$select=id,subject,receivedDateTime,isRead,categories'

  // 1) Chemin principal — filtre serveur : uniquement les non-traités.
  try {
    const filter = encodeURIComponent(`not categories/any(c:c eq '${PROCESSED_CATEGORY}')`)
    const data = await graphGet(
      token,
      `/users/${MISSIONS_EMAIL}/mailFolders/inbox/messages` +
      `?$filter=${filter}&$count=true&$top=${MAX_UNTAGGED}&${select}` +
      `&$orderby=receivedDateTime asc`,
      { ConsistencyLevel: 'eventual' }
    )
    const rows: any[] = data.value || []
    console.log(`[PollMissions] filtre serveur OK : ${rows.length} non-traité(s)`)
    return rows.map(m => ({ id: m.id, receivedDateTime: m.receivedDateTime, categories: m.categories || [] }))
  } catch (e: any) {
    console.warn('[PollMissions] filtre serveur KO → repli scan paginé:', e.message)
  }

  // 2) Repli — scan paginé décroissant, collecte des non-taggés.
  const untagged: Msg[] = []
  let path: string | null =
    `/users/${MISSIONS_EMAIL}/mailFolders/inbox/messages?$top=${PAGE_SIZE}&${select}&$orderby=receivedDateTime desc`
  let pages = 0
  while (path && pages < MAX_SCAN_PAGES && untagged.length < MAX_UNTAGGED) {
    const data = await graphGet(token, path)
    for (const m of (data.value || [])) {
      if (Array.isArray(m.categories) && m.categories.includes(PROCESSED_CATEGORY)) continue
      untagged.push({ id: m.id, receivedDateTime: m.receivedDateTime, categories: m.categories || [] })
    }
    const next: string | undefined = data['@odata.nextLink']
    path = next ? next.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null
    pages++
  }
  console.log(`[PollMissions] repli scan : ${untagged.length} non-traité(s) sur ${pages} page(s)`)
  return untagged
}

export async function GET(req: Request) {
  // Protection : seul Vercel cron (avec CRON_SECRET) peut declencher ce endpoint.
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, number> = { new: 0, duplicate: 0, skipped: 0, error: 0, inserted: 0, deferred: 0 }

  try {
    const token = await getGraphToken()

    const untagged = await collectUntagged(token)
    // FIFO : on traite du PLUS ANCIEN au plus récent → un mail livré en retard
    // (donc plus ancien) passe AVANT les nouveaux, plus de famine.
    untagged.sort((a, b) => new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime())

    const startedAt = Date.now()
    let processed = 0
    for (const message of untagged) {
      // Budget temps : ne pas entamer un parse si on risque de se faire couper.
      if (Date.now() - startedAt > TIME_BUDGET_MS || processed >= MAX_PROCESS) {
        results.deferred++       // sera repris au prochain poll (toujours non taggé)
        continue
      }
      processed++
      try {
        const result = await processEmailMessage(message.id)
        results[result.status] = (results[result.status] || 0) + 1
        if (result.status === 'inserted') results.inserted++

        // Tag "traité" si le processing a abouti (inserted / duplicate / skip
        // définitif). En cas d'erreur : PAS de tag → retenté au prochain poll
        // + par le cron reprocess-errors.
        if (result.status === 'inserted' || result.status === 'duplicate' || result.status === 'skipped') {
          await tagEmailAsProcessed(token, message.id, message.categories).catch(() => {})
        }
      } catch (err: any) {
        console.error(`[PollMissions] Erreur:`, err.message)
        results.error++
      }
    }

    results.new = results.inserted
    return NextResponse.json({ ok: true, scanned: untagged.length, processed, ...results })

  } catch (err: any) {
    console.error('[PollMissions] Erreur fatale:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
