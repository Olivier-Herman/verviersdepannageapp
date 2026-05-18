// src/app/api/admin/tarifs/route.ts
//
// CRUD endpoints pour source_tariffs. Superadmin uniquement.
//
// GET    /api/admin/tarifs?source=vab          -> liste les tarifs (filtre source)
// POST   /api/admin/tarifs                     -> cree un ou plusieurs tarifs
// PATCH  /api/admin/tarifs/:id                 -> dans [id]/route.ts
// DELETE /api/admin/tarifs/:id                 -> dans [id]/route.ts

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

export async function GET(req: Request) {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const source = searchParams.get('source')
  const includeExpired = searchParams.get('expired') === 'true'

  const sb = createAdminClient()
  let q = sb.from('source_tariffs').select('*').order('source').order('mission_type').order('effective_from', { ascending: false })
  if (source) q = q.eq('source', source)
  if (!includeExpired) q = q.or('effective_to.is.null,effective_to.gte.' + new Date().toISOString().slice(0, 10))

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tariffs: data || [] })
}

export async function POST(req: Request) {
  const session = await requireSuperadmin()
  if (!session) return NextResponse.json({ error: 'Acces superadmin requis' }, { status: 403 })

  const body = await req.json()
  const items = Array.isArray(body.tariffs) ? body.tariffs : [body]
  const documentPath = body.document_path || null
  const documentName = body.document_name || null

  if (items.length === 0) return NextResponse.json({ error: 'Aucun tarif fourni' }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb
    .from('users').select('id').eq('email', session.user!.email!).single()

  const rows = items.map((t: any) => ({
    source:                String(t.source || 'autre').toLowerCase().trim(),
    mission_type:          String(t.mission_type || 'depannage').toLowerCase().trim(),
    unit_price:            t.unit_price ?? null,
    km_inclus:             Number(t.km_inclus || 0),
    km_price:              t.km_price ?? null,
    km_basis:              t.km_basis === 'total' ? 'total' : 'charged',
    parc_day_price:        t.parc_day_price ?? null,
    surcharge_night_pct:   Number(t.surcharge_night_pct || 0),
    surcharge_we_pct:      Number(t.surcharge_we_pct || 0),
    surcharge_holiday_pct: Number(t.surcharge_holiday_pct || 0),
    conditions:            t.conditions || null,
    is_autofac:            Boolean(t.is_autofac),
    effective_from:        t.effective_from || new Date().toISOString().slice(0, 10),
    effective_to:          t.effective_to || null,
    source_document_path:  documentPath,
    source_document_name:  documentName,
    notes:                 t.raw_quote ? `Extraction IA: "${t.raw_quote}"` : (t.notes || null),
    created_by:            actor?.id || null,
  }))

  const { data, error } = await sb
    .from('source_tariffs')
    .insert(rows)
    .select()

  if (error) {
    console.error('[tarifs] insert error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, inserted: data?.length || 0, tariffs: data })
}
