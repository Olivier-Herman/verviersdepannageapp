// src/app/api/inventaire/sessions/[id]/route.ts
//
// DELETE → ferme la session (set completed_at = now). Les items restent
// accessibles en historique mais la session n est plus "active".
// PATCH  → met a jour auto_print pour la session active

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: sess } = await sb
    .from('inventaire_sessions')
    .select('user_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!sess) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  if (sess.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { auto_print?: boolean; zone_state_id?: number; zone_code?: string; zone_label?: string; zone_full_name?: string }
  const update: any = { updated_at: new Date().toISOString() }
  if (body.auto_print !== undefined)     update.auto_print     = Boolean(body.auto_print)
  if (body.zone_state_id !== undefined)  update.zone_state_id  = body.zone_state_id
  if (body.zone_code !== undefined)      update.zone_code      = body.zone_code
  if (body.zone_label !== undefined)     update.zone_label     = body.zone_label
  if (body.zone_full_name !== undefined) update.zone_full_name = body.zone_full_name

  const { data, error } = await sb.from('inventaire_sessions').update(update).eq('id', params.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, session: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: sess } = await sb
    .from('inventaire_sessions')
    .select('user_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!sess) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  if (sess.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await sb
    .from('inventaire_sessions')
    .update({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
