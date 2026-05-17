// src/app/api/watch/missions/[id]/action/route.ts
//
// POST /api/watch/missions/:id/action { action: 'accept'|'refuse'|'on_way'|'on_site' }
// Auth : Authorization: Bearer <watch-jwt>
//
// Action chauffeur depuis l Apple Watch. Pour terminer une mission (photos,
// encaissement, signature), le chauffeur sort l iPhone — pas d action
// 'completed' depuis la Watch.

import { NextResponse }                          from 'next/server'
import { verifyWatchAuth }                       from '@/lib/auth-watch'
import { performWatchAction, type WatchAction }  from '@/lib/watch/perform-action'

export const dynamic = 'force-dynamic'

const VALID_ACTIONS: WatchAction[] = ['accept', 'refuse', 'on_way', 'on_site']

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await verifyWatchAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = params.id
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { action?: string }
  const action = body.action as WatchAction | undefined
  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'action invalide' }, { status: 400 })
  }

  const result = await performWatchAction(userId, id, action)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }
  return NextResponse.json({ ok: true, mission: result.mission })
}
