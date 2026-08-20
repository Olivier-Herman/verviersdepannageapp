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
import { buildInterventionDescription } from '@/lib/missions/build-quote-lines'
import { withOdooActor }     from '@/lib/odoo'
import { chevauchement }     from '@/lib/facturation/solde'

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
    .select('id, mission_number, external_id, dossier_number, billed_to_id, billed_to_name, vehicle_plate, mission_type, intervention_date, received_at, incident_address, destination_address, redelivery_address, storage_waived')
    .eq('id', params.id)
    .single()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  // ── DESTINATAIRE PROPRE À CETTE FACTURE ───────────────────────────────────
  // « Chaque facture partielle peut avoir un client différent » (Olivier
  // 2026-08-17) : l'assistance règle le dépannage pendant que le client règle
  // son parking. À défaut, le client de la mission.
  const partnerId   = Number(body.billed_to_id) || Number(mission.billed_to_id) || 0
  const partnerName = String(body.billed_to_name || mission.billed_to_name || '')
  if (!partnerId) {
    return NextResponse.json({ error: 'Pas de client à facturer — choisis un destinataire ou renseigne-le sur la fiche.' }, { status: 400 })
  }

  // ── GARDE-FOU : abandon volontaire = gardiennage offert ───────────────────
  // Le modal grise déjà la case, mais un devis partiel peut être poussé depuis
  // un onglet ouvert avant l'abandon. Olivier 2026-08-20.
  if ((mission as any).storage_waived && lines.some(l => l.kind === 'SERV-PARC')) {
    return NextResponse.json({
      error: 'Abandon volontaire enregistré sur cette fiche : le gardiennage a été offert, il ne peut plus être facturé. Retire la ligne de parc.',
    }, { status: 409 })
  }

  // ── GARDE-FOU : ne jamais facturer deux fois les mêmes jours de parc ───────
  // Deux personnes qui traitent le même dossier à deux jours d'intervalle, et
  // le gardiennage part en double sans que rien ne le signale.
  const { data: dejaFactures } = await sb.from('mission_billed_items')
    .select('kind, label, qty, price_unit, amount_htva, period_from, period_to, billed_at')
    .eq('mission_id', params.id)
  for (const l of lines) {
    if (l.kind !== 'SERV-PARC' || !l.period_from || !l.period_to) continue
    const conflit = chevauchement(l.period_from, l.period_to, (dejaFactures || []) as any)
    if (conflit) {
      return NextResponse.json({
        error: `Ces jours de parc ont déjà été facturés (du ${String(conflit.period_from).slice(0, 10)} au ${String(conflit.period_to).slice(0, 10)}). `
             + `La prochaine tranche doit démarrer après cette date.`,
      }, { status: 409 })
    }
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
        partner_id:       partnerId,
        origin:           `${missionRef} (partiel)`,
        client_order_ref: mission.dossier_number || mission.external_id || undefined,
        fleet_vehicle_id: fleetVehicleId,
        sections:         [{ lines: quoteLines }],
        description:      buildInterventionDescription(mission as any),
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
    odoo_quote_id:  result.id,
    billed_by:      actor?.id ?? null,
    billed_to_id:   partnerId,
    billed_to_name: partnerName || null,
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
