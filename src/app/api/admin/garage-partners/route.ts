// CRUD admin pour les garages partenaires (Espace client garages).
// Reserve admin/superadmin. Olivier 2026-06-02.
// Cf [[project-espace-client-garages]].

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function requireAdmin(session: any): boolean {
  const role: string = session?.user?.role || ''
  return ['admin', 'superadmin'].includes(role)
}

/**
 * GET : liste tous les garages partners.
 * Tarifs geres dans /admin/tarifs (source_tariffs), plus dans cette page.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('garage_partners')
    .select('*')
    .order('active', { ascending: false })
    .order('name',   { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ partners: data || [] })
}

function generateSourceKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `garage_${s}`
}

/**
 * POST : cree un garage_partner + ses tarifs en une seule transaction logique.
 * Body : { name, odoo_partner_id, contact_email, contact_phone, address,
 *          notes, active, tariffs: { dsp_price, rem_price, dpr_price, currency } }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400 })

  const sb = createAdminClient()

  // Genere une source_key unique (retry si collision)
  let sourceKey = generateSourceKey()
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await sb.from('mission_source_catalog').select('key').eq('key', sourceKey).maybeSingle()
    if (!existing) break
    sourceKey = generateSourceKey()
  }

  const { data: partner, error: pErr } = await sb.from('garage_partners').insert({
    name,
    source_key:      sourceKey,
    odoo_partner_id: body.odoo_partner_id != null && body.odoo_partner_id !== '' ? Number(body.odoo_partner_id) : null,
    contact_email:   body.contact_email   || null,
    contact_phone:   body.contact_phone   || null,
    address:         body.address         || null,
    notes:           body.notes           || null,
    active:          body.active !== false,
  }).select().single()
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  // Insert dans mission_source_catalog pour que les tarifs source_tariffs
  // puissent matcher sur cette cle (meme pattern que touring, ethias, etc.).
  await sb.from('mission_source_catalog').insert({
    key:        sourceKey,
    label:      name,
    sort_order: 200,
  })

  return NextResponse.json({ partner })
}

/**
 * PATCH ?id=xxx : update partner + ses tarifs en bloc.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const sb = createAdminClient()

  // Patch garage_partners
  const partnerPatch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.name             !== undefined) partnerPatch.name             = String(body.name).trim()
  if (body.odoo_partner_id  !== undefined) partnerPatch.odoo_partner_id  = body.odoo_partner_id != null && body.odoo_partner_id !== '' ? Number(body.odoo_partner_id) : null
  if (body.contact_email    !== undefined) partnerPatch.contact_email    = body.contact_email || null
  if (body.contact_phone    !== undefined) partnerPatch.contact_phone    = body.contact_phone || null
  if (body.address          !== undefined) partnerPatch.address          = body.address       || null
  if (body.notes            !== undefined) partnerPatch.notes            = body.notes         || null
  if (body.active           !== undefined) partnerPatch.active           = !!body.active

  if (Object.keys(partnerPatch).length > 1) {
    const { data: updated, error: pErr } = await sb.from('garage_partners')
      .update(partnerPatch).eq('id', id).select('source_key, name, active').single()
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
    // Sync mission_source_catalog si nom ou active a change
    if (updated?.source_key) {
      await sb.from('mission_source_catalog')
        .update({ label: updated.name, active: updated.active, updated_at: new Date().toISOString() })
        .eq('key', updated.source_key)
    }
  }

  // Renvoie partner frais
  const { data: fresh } = await sb
    .from('garage_partners')
    .select('*')
    .eq('id', id)
    .single()

  return NextResponse.json({ partner: fresh })
}

/**
 * DELETE ?id=xxx : soft delete (active=false). Preserve historique des missions.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb.from('garage_partners')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('source_key')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Desactiver aussi dans mission_source_catalog
  if (data?.source_key) {
    await sb.from('mission_source_catalog').update({ active: false }).eq('key', data.source_key)
  }
  return NextResponse.json({ partner: data })
}
