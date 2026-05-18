// src/app/api/admin/tarifs/rules/route.ts
//
// CRUD pour tariff_rules (regles dynamiques).
// GET    /api/admin/tarifs/rules    -> liste
// POST   /api/admin/tarifs/rules    -> cree une/plusieurs regles

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

export async function GET() {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('tariff_rules')
    .select('*')
    .order('priority')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rules: data || [] })
}

export async function POST(req: Request) {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const body = await req.json()
  const items = Array.isArray(body.rules) ? body.rules : [body]
  if (items.length === 0) return NextResponse.json({ error: 'Aucune regle' }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', session.user!.email!).single()

  const rows = items.map((r: any) => ({
    description:         String(r.description || '').slice(0, 1000),
    reason:              r.reason || null,
    filter_source:       r.filter_source       || null,
    filter_mission_type: r.filter_mission_type || null,
    filter_date_from:    r.filter_date_from    || null,
    filter_date_to:      r.filter_date_to      || null,
    filter_client_name:  r.filter_client_name  || null,
    operation_type:      r.operation_type      || 'add_fixed',
    operation_value:     Number(r.operation_value || 0),
    active:              r.active !== false,
    priority:            Number(r.priority || 100),
    created_by:          actor?.id || null,
  }))

  const { data, error } = await sb.from('tariff_rules').insert(rows).select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, inserted: data?.length || 0, rules: data })
}
