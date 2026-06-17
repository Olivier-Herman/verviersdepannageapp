// src/app/api/missions/[id]/partial-invoice/route.ts
//
// POST /api/missions/[id]/partial-invoice
//   body: { lines: [{ kind, label, qty, price_unit, period_from?, period_to? }] }
//
// Facture partielle fourrière : prépare un devis Odoo séparé avec UNIQUEMENT les
// postes sélectionnés (ex. dépannage, ou une tranche de gardiennage), enregistre
// ces postes dans mission_billed_items, et LAISSE le véhicule en parc.
// À la facturation finale, on exclura ces postes (cf project_facture_partielle).
//
// Réservé au staff (admin/superadmin/dispatcher/facturation/fourrière).
// Olivier 2026-06-17.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { createSaleOrder, findFleetVehicleByPlate, type QuoteLine } from '@/lib/odoo-quote'
import { withOdooActor }     from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

function canAccess(session: any): boolean {
  if (!session) return false
  const role = (session.user as any)?.role || ''
  const modules: string[] = (session.user as any)?.modules || []
  return ['admin', 'superadmin', 'dispatcher'].includes(role)
    || modules.includes('facturation') || modules.includes('fourriere')
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const rawLines: any[] = Array.isArray(body.lines) ? body.lines : []
  const lines = rawLines
    .map(l => ({
      kind:        String(l.kind || 'SERV-DIV'),
      label:       String(l.label || '').trim(),
      qty:         Number(l.qty) || 0,
      price_unit:  Number(l.price_unit) || 0,
      period_from: l.period_from || null,
      period_to:   l.period_to || null,
    }))
    .filter(l => l.label && l.qty > 0)
  if (lines.length === 0) return NextResponse.json({ error: 'Aucun poste à facturer' }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb
    .from('users').select('id').eq('email', session!.user!.email!).single()

  const { data: mission } = await sb
    .from('incoming_missions')
    .select('id, mission_number, external_id, dossier_number, billed_to_id, billed_to_name, vehicle_plate')
    .eq('id', params.id)
    .single()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (!mission.billed_to_id) {
    return NextResponse.json({ error: 'Pas de client à facturer (billed_to_id) — renseigne-le d\'abord sur la fiche.' }, { status: 400 })
  }

  const missionRef = mission.external_id || mission.dossier_number || `M-${mission.id.slice(0, 8)}`
  const quoteLines: QuoteLine[] = lines.map(l => ({
    kind:       l.kind as any,
    name:       l.label,
    qty:        l.qty,
    price_unit: l.price_unit,
  }))

  // 1) Crée le devis Odoo partiel
  let result: { id: number; url: string }
  try {
    result = await withOdooActor(actor?.id, async () => {
      let fleetVehicleId: number | null = null
      if (mission.vehicle_plate) fleetVehicleId = await findFleetVehicleByPlate(mission.vehicle_plate)
      return await createSaleOrder({
        partner_id:       mission.billed_to_id as number,
        origin:           `${missionRef} (partiel)`,
        client_order_ref: mission.dossier_number || undefined,
        fleet_vehicle_id: fleetVehicleId,
        sections:         [{ lines: quoteLines }],
      })
    })
  } catch (e: any) {
    console.error('[partial-invoice] Odoo KO:', e.message)
    return NextResponse.json({ error: `Erreur Odoo : ${e.message}` }, { status: 502 })
  }

  // 2) Enregistre les postes facturés (registre VD Soft)
  const rows = lines.map(l => ({
    mission_id:    params.id,
    kind:          l.kind,
    label:         l.label,
    qty:           l.qty,
    price_unit:    l.price_unit,
    amount_htva:   Math.round(l.qty * l.price_unit * 10000) / 10000,
    period_from:   l.period_from,
    period_to:     l.period_to,
    odoo_quote_id: result.id,
    billed_by:     actor?.id ?? null,
  }))
  const { error: insErr } = await sb.from('mission_billed_items').insert(rows)
  if (insErr) {
    // Le devis Odoo existe déjà ; on signale mais on ne bloque pas.
    console.error('[partial-invoice] insert billed_items KO:', insErr.message)
  }

  await sb.from('mission_logs').insert({
    mission_id: params.id, actor_id: actor?.id ?? null, action: 'partial_invoice',
    notes: `Facture partielle préparée (${lines.length} poste(s)) — devis Odoo`,
    metadata: { odoo_quote_id: result.id, lines: lines.map(l => l.label) },
  })

  return NextResponse.json({ ok: true, quote_id: result.id, quote_url: result.url, items: rows.length })
}
