// PATCH / DELETE d une regle tarifaire individuelle.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireSuperadmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const role  = (session.user as any).role  || ''
  const roles = (session.user as any).roles || [role]
  const allRoles: string[] = Array.isArray(roles) ? roles : [roles]
  if (!allRoles.includes('superadmin')) return null
  return session
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const body = await req.json()
  const sb = createAdminClient()

  const allowed: Record<string, any> = {}
  for (const key of [
    'description', 'reason',
    'filter_source', 'filter_mission_type', 'filter_date_from', 'filter_date_to', 'filter_client_name',
    'operation_type', 'operation_value', 'active', 'priority',
  ]) {
    if (body[key] !== undefined) allowed[key] = body[key]
  }
  allowed.updated_at = new Date().toISOString()

  const { data, error } = await sb
    .from('tariff_rules')
    .update(allowed)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rule: data })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const sb = createAdminClient()
  const { error } = await sb.from('tariff_rules').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
