// src/app/api/users/presence/route.ts
//
// Statut de présence MANUEL (En ligne / Hors ligne) du user connecté.
//   GET           → { offline: boolean }
//   POST { offline } → bascule le statut manuel.
// Stocké dans users.notif_preferences.presence_offline (jsonb, pas de migration).
// C'est ce statut qui coupe les notifs opérationnelles et le « vert » au dispatch.
// « On base le ok notif sur le statut » — Olivier 2026-08-09.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function me(sb: any, email?: string | null) {
  if (!email) return null
  const { data } = await sb.from('users').select('id, notif_preferences').eq('email', email).maybeSingle()
  return data
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const u = await me(sb, session.user?.email)
  if (!u) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })
  return NextResponse.json({ offline: (u.notif_preferences || {}).presence_offline === true })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const u = await me(sb, session.user?.email)
  if (!u) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const offline = !!body.offline
  const merged = { ...(u.notif_preferences || {}), presence_offline: offline }
  const { error } = await sb.from('users').update({ notif_preferences: merged }).eq('id', u.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, offline })
}
