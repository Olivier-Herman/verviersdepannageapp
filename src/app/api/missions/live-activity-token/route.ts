// POST /api/missions/live-activity-token  { mission_id, token }
// Enregistre le push token ActivityKit d'une Live Activity, pour pouvoir pousser
// les mises à jour en temps réel quand l'app est suspendue (utilisé par le push
// serveur — v2). Best-effort. Olivier 2026-07-28.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const missionId = String(body?.mission_id || '')
  const token     = String(body?.token || '')
  if (!missionId || !token) return NextResponse.json({ error: 'mission_id + token requis' }, { status: 400 })

  // Ignore la mission de démo (pas une vraie fiche).
  if (missionId === 'demo-mission') return NextResponse.json({ ok: true, demo: true })

  const sb = createAdminClient()
  await sb.from('incoming_missions').update({ live_activity_push_token: token }).eq('id', missionId).then(() => {}, () => {})
  return NextResponse.json({ ok: true })
}
