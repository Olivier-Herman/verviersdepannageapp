// src/app/api/admin/towsoft-migration/check-odoo-invoices/route.ts
//
// POST /api/admin/towsoft-migration/check-odoo-invoices
// Body : { mission_id }
//
// Cherche dans Odoo s il existe des factures (account.move) ou devis
// (sale.order) lies a ce vehicule. Permet a l operateur en UI Nettoyage
// Transit de decider :
//   - facture existe -> probablement sorti legalement (action : sortie_avant_migration)
//   - rien dans Odoo -> probablement fantome / a chercher Verviers
//
// Strategie de recherche :
//   1. Si mission a odoo_helpdesk_id : sale.order LIES au ticket (custom field)
//   2. Si mission a odoo_vehicle_id : sale.order avec x_studio_vehicle_id
//   3. Par fallback : sale.order par x_studio_plaque ou name LIKE %plate%

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc, withOdooActor } from '@/lib/odoo'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const missionId = String(body.mission_id || '').trim()
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()

  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_vin, odoo_vehicle_id, odoo_helpdesk_id, external_id')
    .eq('id', missionId)
    .maybeSingle()
  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  return withOdooActor(actor?.id, async () => {
    const found: any[] = []

    // 1. Recherche sale.order par odoo_vehicle_id (custom field x_studio_vehicle_id)
    if (mission.odoo_vehicle_id) {
      try {
        const orders = await odooRpc<any[]>('sale.order', 'search_read', [
          [['x_studio_vehicle_id', '=', mission.odoo_vehicle_id]],
        ], {
          fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state', 'invoice_status'],
          limit:  20,
        })
        for (const o of (orders || [])) {
          found.push({ ...o, _source: 'by_vehicle_id' })
        }
      } catch (e: any) { console.warn('[check-odoo-invoices] vehicle_id search KO:', e?.message) }
    }

    // 2. Recherche sale.order par helpdesk_ticket (custom field x_studio_helpdesk_ticket_id)
    if (mission.odoo_helpdesk_id) {
      try {
        const orders = await odooRpc<any[]>('sale.order', 'search_read', [
          [['x_studio_helpdesk_ticket_id', '=', mission.odoo_helpdesk_id]],
        ], {
          fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state', 'invoice_status'],
          limit:  20,
        })
        for (const o of (orders || [])) {
          if (!found.find(f => f.id === o.id)) {
            found.push({ ...o, _source: 'by_helpdesk_id' })
          }
        }
      } catch (e: any) { console.warn('[check-odoo-invoices] helpdesk_id search KO:', e?.message) }
    }

    // 3. Recherche sale.order par plaque (fallback : name LIKE)
    if (mission.vehicle_plate && found.length === 0) {
      try {
        const plate = String(mission.vehicle_plate).toUpperCase().replace(/[\s\-\.]/g, '')
        const orders = await odooRpc<any[]>('sale.order', 'search_read', [
          ['|',
            ['name', 'ilike', plate],
            ['client_order_ref', 'ilike', plate],
          ],
        ], {
          fields: ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'state', 'invoice_status', 'client_order_ref'],
          limit:  10,
        })
        for (const o of (orders || [])) {
          if (!found.find(f => f.id === o.id)) {
            found.push({ ...o, _source: 'by_plate_fuzzy' })
          }
        }
      } catch (e: any) { console.warn('[check-odoo-invoices] plate search KO:', e?.message) }
    }

    return NextResponse.json({
      ok: true,
      mission: {
        id: mission.id,
        mission_number: mission.mission_number,
        plate: mission.vehicle_plate,
        vin: mission.vehicle_vin,
        odoo_vehicle_id: mission.odoo_vehicle_id,
        odoo_helpdesk_id: mission.odoo_helpdesk_id,
      },
      orders_found: found.length,
      orders: found.map(o => ({
        id:             o.id,
        name:           o.name,
        partner_name:   Array.isArray(o.partner_id) ? o.partner_id[1] : null,
        partner_id:     Array.isArray(o.partner_id) ? o.partner_id[0] : null,
        date_order:     o.date_order,
        amount_total:   o.amount_total,
        state:          o.state,
        invoice_status: o.invoice_status,
        client_order_ref: o.client_order_ref || null,
        source:         o._source,
        odoo_url: `https://verviers-depannage.odoo.com/web#id=${o.id}&model=sale.order&view_type=form`,
      })),
    })
  }).catch((e: any) => NextResponse.json({ error: e?.message || 'Erreur Odoo' }, { status: 500 }))
}
