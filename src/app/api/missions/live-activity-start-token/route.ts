// POST /api/missions/live-activity-start-token  { token }
// Enregistre le « push-to-start » token ActivityKit du device (iOS 17.2+) sur
// l'utilisateur, pour pouvoir DÉMARRER à distance sa Live Activity mission dès
// l'attribution (accepter sans ouvrir l'app). Olivier 2026-07-26.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const token = String(body?.token || '')
  if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: user } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()
  if (!user) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  await sb.from('users').update({ la_push_to_start_token: token }).eq('id', user.id).then(() => {}, () => {})
  return NextResponse.json({ ok: true })
}
