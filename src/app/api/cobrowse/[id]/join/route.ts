// src/app/api/cobrowse/[id]/join/route.ts
// POST : admin rejoint une session pending -> passe en 'active'.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, name').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  // Verifie statut
  const { data: cs } = await sb
    .from('cobrowse_sessions')
    .select('id, status, admin_id, user_id')
    .eq('id', params.id)
    .single()
  if (!cs) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  if (cs.status === 'ended' || cs.status === 'cancelled') {
    return NextResponse.json({ error: 'Session déjà terminée' }, { status: 400 })
  }
  if (cs.admin_id && cs.admin_id !== me.id) {
    return NextResponse.json({ error: 'Session déjà prise en charge par un autre admin' }, { status: 409 })
  }

  await sb.from('cobrowse_sessions').update({
    admin_id:        me.id,
    admin_joined_at: new Date().toISOString(),
    status:          'active',
    updated_at:      new Date().toISOString(),
  }).eq('id', params.id)

  return NextResponse.json({ ok: true, session_id: params.id, user_id: cs.user_id })
}
