// src/app/api/cobrowse/[id]/stop/route.ts
// POST : termine la session (par user OU admin OU timeout).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const reason = body.reason || 'manual'

  const { data: cs } = await sb
    .from('cobrowse_sessions')
    .select('id, status, user_id, admin_id')
    .eq('id', params.id)
    .single()
  if (!cs) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })

  // Le user proprietaire OU l admin lie peut stopper
  if (cs.user_id !== me.id && cs.admin_id !== me.id) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  await sb.from('cobrowse_sessions').update({
    status:       'ended',
    ended_at:     new Date().toISOString(),
    ended_by:     me.id,
    ended_reason: reason,
    updated_at:   new Date().toISOString(),
  }).eq('id', params.id)

  return NextResponse.json({ ok: true })
}
