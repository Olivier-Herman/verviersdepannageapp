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
 * GET : liste tous les garages partners avec leurs tarifs (LEFT JOIN).
 * Inclut active=false pour visibilite admin (filtre cote UI).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('garage_partners')
    .select(`
      *,
      garage_tariffs ( dsp_price, rem_price, dpr_price, currency )
    `)
    .order('active', { ascending: false })
    .order('name',   { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten tariffs pour l UI
  const partners = (data || []).map(p => ({
    ...p,
    tariffs: Array.isArray((p as any).garage_tariffs) && (p as any).garage_tariffs.length > 0
      ? (p as any).garage_tariffs[0]
      : { dsp_price: null, rem_price: null, dpr_price: null, currency: 'EUR' },
    garage_tariffs: undefined,
  }))

  return NextResponse.json({ partners })
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
  const { data: partner, error: pErr } = await sb.from('garage_partners').insert({
    name,
    odoo_partner_id: body.odoo_partner_id != null && body.odoo_partner_id !== '' ? Number(body.odoo_partner_id) : null,
    contact_email:   body.contact_email   || null,
    contact_phone:   body.contact_phone   || null,
    address:         body.address         || null,
    notes:           body.notes           || null,
    active:          body.active !== false,
  }).select().single()
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  // Tarifs (optionnels a la creation, completables apres). 3 valeurs par
  // type d intervention : prise_en_charge + km_inclus + km_price.
  const tariffs = body.tariffs || {}
  const num = (v: any) => v != null && v !== '' ? Number(v) : null
  const int = (v: any) => v != null && v !== '' ? parseInt(v, 10) || 0 : 0
  const { data: t, error: tErr } = await sb.from('garage_tariffs').upsert({
    garage_partner_id:   partner.id,
    dsp_prise_en_charge: num(tariffs.dsp_prise_en_charge),
    dsp_km_inclus:       int(tariffs.dsp_km_inclus),
    dsp_km_price:        num(tariffs.dsp_km_price),
    rem_prise_en_charge: num(tariffs.rem_prise_en_charge),
    rem_km_inclus:       int(tariffs.rem_km_inclus),
    rem_km_price:        num(tariffs.rem_km_price),
    dpr_prise_en_charge: num(tariffs.dpr_prise_en_charge),
    dpr_km_inclus:       int(tariffs.dpr_km_inclus),
    dpr_km_price:        num(tariffs.dpr_km_price),
    currency:            tariffs.currency || 'EUR',
    updated_at:          new Date().toISOString(),
  }).select().single()
  if (tErr) console.error('[garage-partners] tariffs upsert failed:', tErr.message)

  return NextResponse.json({
    partner: { ...partner, tariffs: t || null },
  })
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
    const { error: pErr } = await sb.from('garage_partners').update(partnerPatch).eq('id', id)
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  }

  // Patch garage_tariffs (upsert) - structure prise_en_charge + km
  if (body.tariffs) {
    const t = body.tariffs
    const num = (v: any) => v != null && v !== '' ? Number(v) : null
    const int = (v: any) => v != null && v !== '' ? parseInt(v, 10) || 0 : 0
    const { error: tErr } = await sb.from('garage_tariffs').upsert({
      garage_partner_id:   id,
      dsp_prise_en_charge: num(t.dsp_prise_en_charge),
      dsp_km_inclus:       int(t.dsp_km_inclus),
      dsp_km_price:        num(t.dsp_km_price),
      rem_prise_en_charge: num(t.rem_prise_en_charge),
      rem_km_inclus:       int(t.rem_km_inclus),
      rem_km_price:        num(t.rem_km_price),
      dpr_prise_en_charge: num(t.dpr_prise_en_charge),
      dpr_km_inclus:       int(t.dpr_km_inclus),
      dpr_km_price:        num(t.dpr_km_price),
      currency:            t.currency || 'EUR',
      updated_at:          new Date().toISOString(),
    })
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  }

  // Renvoie partner + tarifs frais
  const { data: fresh } = await sb
    .from('garage_partners')
    .select(`*, garage_tariffs ( dsp_price, rem_price, dpr_price, currency )`)
    .eq('id', id)
    .single()

  const partner = fresh ? {
    ...fresh,
    tariffs: Array.isArray((fresh as any).garage_tariffs) && (fresh as any).garage_tariffs.length > 0
      ? (fresh as any).garage_tariffs[0]
      : { dsp_price: null, rem_price: null, dpr_price: null, currency: 'EUR' },
    garage_tariffs: undefined,
  } : null

  return NextResponse.json({ partner })
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
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ partner: data })
}
