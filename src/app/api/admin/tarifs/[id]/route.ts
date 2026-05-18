// src/app/api/admin/tarifs/[id]/route.ts
// PATCH / DELETE d un tarif individuel.

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
    'source', 'mission_type', 'unit_price', 'km_inclus', 'km_price', 'km_basis',
    'parc_day_price', 'surcharge_night_pct', 'surcharge_we_pct',
    'surcharge_holiday_pct', 'conditions', 'is_autofac',
    'effective_from', 'effective_to', 'notes',
  ]) {
    if (body[key] !== undefined) allowed[key] = body[key]
  }
  if (allowed.km_basis !== undefined) allowed.km_basis = allowed.km_basis === 'total' ? 'total' : 'charged'
  allowed.updated_at = new Date().toISOString()

  const { data, error } = await sb
    .from('source_tariffs')
    .update(allowed)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tariff: data })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const sb = createAdminClient()
  const { error } = await sb
    .from('source_tariffs')
    .update({ effective_to: new Date().toISOString().slice(0, 10) })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
