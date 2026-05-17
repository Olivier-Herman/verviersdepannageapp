// src/app/api/watch/queued-actions/route.ts
//
// POST /api/watch/queued-actions { actions: [{ mission_id, action, ts }] }
// Auth : Authorization: Bearer <watch-jwt>
//
// Batch flush des actions accumulees offline cote Watch. Chaque action est
// rejouee en ordre (FIFO) avec idempotence — si une action a deja ete
// appliquee (server a deja le statut cible), elle est consideree ok noop.
// Retourne le resultat par action pour permettre a la Watch de purger sa
// queue ou re-tenter (en cas d erreur transitoire 5xx).

import { NextResponse }                          from 'next/server'
import { verifyWatchAuth }                       from '@/lib/auth-watch'
import { performWatchAction, type WatchAction }  from '@/lib/watch/perform-action'

export const dynamic = 'force-dynamic'

interface QueuedAction {
  mission_id: string
  action:     WatchAction
  ts?:        string
}

const VALID_ACTIONS: WatchAction[] = ['accept', 'refuse', 'on_way', 'on_site']
const MAX_BATCH = 50

export async function POST(req: Request) {
  const userId = await verifyWatchAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { actions?: QueuedAction[] }
  const actions = Array.isArray(body.actions) ? body.actions : []
  if (actions.length === 0) return NextResponse.json({ ok: true, results: [] })
  if (actions.length > MAX_BATCH) {
    return NextResponse.json({ error: `Batch trop gros (max ${MAX_BATCH})` }, { status: 400 })
  }

  const results: Array<{
    mission_id: string
    action:     string
    ok:         boolean
    status:     number
    error?:     string
  }> = []

  // FIFO sequential : preserve l ordre des transitions (accept doit precede on_way etc.)
  for (const a of actions) {
    if (!a.mission_id || !a.action || !VALID_ACTIONS.includes(a.action)) {
      results.push({
        mission_id: a.mission_id || '',
        action:     String(a.action || ''),
        ok:         false,
        status:     400,
        error:      'action invalide',
      })
      continue
    }
    const r = await performWatchAction(userId, a.mission_id, a.action)
    results.push({
      mission_id: a.mission_id,
      action:     a.action,
      ok:         r.ok,
      status:     r.status || (r.ok ? 200 : 500),
      error:      r.error,
    })
  }

  return NextResponse.json({ ok: true, results })
}
