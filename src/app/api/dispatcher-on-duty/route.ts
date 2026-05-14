// src/app/api/dispatcher-on-duty/route.ts
//
// GET   /api/dispatcher-on-duty           → { user_id, name, set_at, set_by_name }
// PATCH /api/dispatcher-on-duty { user_id } → set le dispatcher de garde
//
// Singleton (table id=1). Accessible a tout user connecte en lecture,
// modifiable par admin/superadmin/dispatcher.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data } = await sb
    .from('dispatcher_on_duty')
    .select('user_id, set_at, set_by, on_duty:users!dispatcher_on_duty_user_id_fkey(id, name), by:users!dispatcher_on_duty_set_by_fkey(name)')
    .eq('id', 1)
    .maybeSingle()

  return NextResponse.json({
    user_id:     data?.user_id || null,
    name:        (data?.on_duty as any)?.name || null,
    set_at:      data?.set_at  || null,
    set_by_name: (data?.by      as any)?.name || null,
  })
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin', 'dispatcher'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body   = await req.json() as { user_id?: string | null }
  const userId = body.user_id || null

  const sb = createAdminClient()

  // Si userId fourni, valider que c'est bien un dispatcher (role) actif
  if (userId) {
    const { data: target } = await sb
      .from('users')
      .select('id, role, active')
      .eq('id', userId)
      .maybeSingle()
    if (!target)            return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    if (!target.active)     return NextResponse.json({ error: 'Utilisateur inactif' }, { status: 400 })
    if (!['admin', 'superadmin', 'dispatcher'].includes(target.role)) {
      return NextResponse.json({ error: 'Cet utilisateur ne peut pas etre dispatcher de garde' }, { status: 400 })
    }
  }

  const { error } = await sb
    .from('dispatcher_on_duty')
    .update({
      user_id: userId,
      set_at:  new Date().toISOString(),
      set_by:  (session.user as any).id || null,
    })
    .eq('id', 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
