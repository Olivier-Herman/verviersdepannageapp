// src/app/api/fourriere/fiche/[id]/route.ts
//
// GET /api/fourriere/fiche/[id]
// Charge toute la fiche d un vehicule en fourriere : intervention, info police,
// info parc (zone/rangee/slot/duree), calcul tarif provisoire.
//
// Olivier 2026-06-03 : utilise pour le panel de fiche complete dans /fourriere.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { estimateMissionPrice } from '@/lib/missions/estimate-price'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: m, error } = await sb
    .from('incoming_missions')
    .select(`
      id, mission_number, external_id, dossier_number, source, mission_type,
      status, snc_scenario,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, vehicle_class,
      client_name, client_phone, client_address,
      billed_to_name,
      incident_address, incident_city, incident_country,
      destination_address,
      police_pv_number, officer_name, police_zone,
      saisie_motif_code, saisie_motif_label,
      dpr_motif, dpr_motif_label,
      parc_zone_key, parc_row_number, parc_slot_index,
      parked_at, loaded_at, received_at, intervention_date, completed_at,
      payment_amount, payment_mode, payment_collected_at, payment_breakdown,
      odoo_quote_id, odoo_quote_url, odoo_vehicle_id, odoo_ticket_id,
      special_tarif_htva,
      assigned_to, assigned_user:users!incoming_missions_assigned_to_fkey (name)
    `)
    .eq('id', params.id)
    .single()
  if (error || !m) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 })

  // Resolve zone + depot
  let zone: any = null
  if (m.parc_zone_key) {
    const { data: z } = await sb
      .from('parc_zones')
      .select('key, label, depot_id, depots:depot_id (id, name, address)')
      .eq('key', m.parc_zone_key)
      .single()
    if (z) zone = z
  }

  // Calcul tarif provisoire — best-effort
  const tarif = await computeProvisionalTariff(sb, m)

  return NextResponse.json({
    mission: m,
    zone,
    tarif,
  })
}

async function computeProvisionalTariff(_sb: any, m: any): Promise<{ amount_tvac: number | null; htva: number | null; details: string[] }> {
  // Si paiement deja encaisse, retour direct (montant fiabilise)
  if (m.payment_amount != null) {
    return {
      amount_tvac: Number(m.payment_amount),
      htva: null,
      details: [`Paiement déjà encaissé : ${Number(m.payment_amount).toFixed(2)} € TVAC (${m.payment_mode || '—'})`],
    }
  }

  // Olivier 2026-06-03 : on utilise estimateMissionPrice (meme moteur que la
  // fiche dispatch + l encaissement) pour un calcul provisoire coherent.
  try {
    const est = await estimateMissionPrice({
      id:                m.id,
      source:            m.source,
      mission_type:      m.mission_type,
      client_name:       m.client_name,
      vehicle_mileage:   null,
      parked_at:         m.parked_at,
      delivering_at:     null,
      completed_at:      m.completed_at,
      intervention_date: m.intervention_date,
      received_at:       m.received_at,
      vehicle_class:     m.vehicle_class || 'car',
      amount_to_collect: m.payment_amount ?? null,
    })
    if (!est.ok) {
      return { amount_tvac: null, htva: null, details: [est.reason || 'Estimation impossible'] }
    }
    const tvac = est.total_tvac_exact != null
      ? est.total_tvac_exact
      : Math.round(est.total_eur * 1.21 * 100) / 100
    const details = est.breakdown
      .filter(b => b.amount != null && b.amount > 0)
      .map(b => `${b.label} : ${(b.amount as number).toFixed(2)} €${b.note ? ` (${b.note})` : ''}`)
    if (est.parc_jours > 0) details.push(`${est.parc_jours} j en parc`)
    if (m.special_tarif_htva) details.push(`Tarif spécial : ${Number(m.special_tarif_htva).toFixed(2)} € HTVA`)
    return {
      amount_tvac: tvac,
      htva:        Math.round(est.total_eur * 100) / 100,
      details,
    }
  } catch (e: any) {
    console.warn('[fiche tarif]', e.message)
    return { amount_tvac: null, htva: null, details: [`Erreur estimation : ${e.message}`] }
  }
}
