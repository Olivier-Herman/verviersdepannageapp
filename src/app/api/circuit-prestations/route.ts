// src/app/api/circuit-prestations/route.ts
//
// GET  /api/circuit-prestations?period=past|current|upcoming|all
//   Liste les prestations filtrees par periode.
//
// POST /api/circuit-prestations
//   Body : { client_name, client_odoo_id?, type, dates[], nb_depanneuses?, notes? }
//   Cree 1 ligne par date + 1 devis Odoo confirme regroupant toutes les dates.
//
// Permissions : dispatcher / admin / superadmin

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { withOdooActor }     from '@/lib/odoo'
import { createCircuitQuote } from '@/lib/circuit/odoo-quote'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['dispatcher', 'admin', 'superadmin']

function hasAccess(user: any): boolean {
  const role = user.role || ''
  const roles = Array.isArray(user.roles) ? user.roles : []
  return ALLOWED_ROLES.includes(role)
      || roles.some((r: string) => ALLOWED_ROLES.includes(r))
}

// ───────────────────────────────────────────────────────────────────────────
// GET — liste
// ───────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(session.user as any)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const period = String(searchParams.get('period') || 'all').toLowerCase()

  const sb = createAdminClient()
  let query = sb
    .from('circuit_prestations')
    .select(`
      id, client_name, client_odoo_id,
      type, prestation_date, nb_depanneuses,
      odoo_sale_order_id, odoo_sale_order_name,
      notes, invoiced_at, invoiced_by, invoice_number,
      created_by, created_at, updated_at
    `)
    .order('prestation_date', { ascending: true })

  const today = new Date().toISOString().slice(0, 10)
  if (period === 'past')      query = query.lt('prestation_date', today)
  else if (period === 'current')  query = query.eq('prestation_date', today)
  else if (period === 'upcoming') query = query.gt('prestation_date', today)
  // else 'all' -> tout

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ prestations: data || [] })
}

// ───────────────────────────────────────────────────────────────────────────
// POST — creation
// ───────────────────────────────────────────────────────────────────────────
interface CreateBody {
  client_name:     string
  client_odoo_id?: number | null
  type:            'incentive' | 'after_six'
  dates:           string[]        // ISO YYYY-MM-DD, 1+ dates
  nb_depanneuses?: number          // 1-6 pour incentive, ignore pour after_six
  notes?:          string
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!hasAccess(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as CreateBody
  const clientName = String(body.client_name || '').trim()
  const clientOdooId = body.client_odoo_id || null
  const type = body.type
  const dates = Array.isArray(body.dates) ? body.dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) : []
  const nbDep = type === 'after_six' ? 1 : Math.max(1, Math.min(6, body.nb_depanneuses || 1))
  const notes = body.notes?.trim() || null

  if (!clientName) return NextResponse.json({ error: 'client_name requis' }, { status: 400 })
  if (!['incentive', 'after_six'].includes(type)) return NextResponse.json({ error: 'type invalide' }, { status: 400 })
  if (dates.length === 0) return NextResponse.json({ error: 'au moins 1 date requise' }, { status: 400 })
  if (!clientOdooId) return NextResponse.json({ error: 'client_odoo_id requis (recherche client Odoo obligatoire pour creer le devis)' }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', user.email).maybeSingle()
  const actorId = actor?.id || null

  // 1. Cree le devis Odoo confirme (1 ligne par date)
  let odooOrder: { id: number; name: string }
  try {
    odooOrder = await withOdooActor(actorId, () => createCircuitQuote({
      partnerId: clientOdooId,
      lines: dates.map(d => ({ type, date: d, nb_depanneuses: nbDep })),
      notes: notes || undefined,
    }))
  } catch (e: any) {
    return NextResponse.json({
      error: `Devis Odoo KO : ${e?.message || e}`,
    }, { status: 500 })
  }

  // 2. Insert les prestations en BDD VD Soft (1 ligne par date, toutes liees au meme devis)
  const rows = dates.map(d => ({
    client_name:    clientName,
    client_odoo_id: clientOdooId,
    type,
    prestation_date: d,
    nb_depanneuses: nbDep,
    odoo_sale_order_id:   odooOrder.id,
    odoo_sale_order_name: odooOrder.name,
    notes,
    created_by:     actorId,
  }))
  const { data: inserted, error: insErr } = await sb
    .from('circuit_prestations')
    .insert(rows)
    .select()
  if (insErr) {
    // Devis cree mais insert KO : on log et on retourne quand meme le devis
    console.error('[circuit-prestations POST] INSERT KO mais devis cree:', insErr.message)
    return NextResponse.json({
      ok: true,
      warning: `Devis Odoo cree (${odooOrder.name}) mais persistance VD Soft KO : ${insErr.message}`,
      odoo_sale_order: odooOrder,
      prestations: [],
    })
  }

  return NextResponse.json({
    ok: true,
    odoo_sale_order: odooOrder,
    prestations:     inserted || [],
    message:         `${dates.length} prestation(s) créée(s) + devis Odoo confirmé ${odooOrder.name}`,
  })
}
