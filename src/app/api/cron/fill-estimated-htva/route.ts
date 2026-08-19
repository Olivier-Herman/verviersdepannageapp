// src/app/api/cron/fill-estimated-htva/route.ts
//
// Calcule + fige le CA HTVA (tarif source : forfait + km) sur les missions
// clôturées SANS facture Odoo (auto-facturées Touring/Mondial…), pour que les
// stats « CA par chauffeur » les comptent. Petits lots (ORS = rate-limité).
// Idempotent : ne traite que estimated_htva IS NULL. Olivier 2026-07-27.

import { NextResponse }          from 'next/server'
import { createAdminClient }     from '@/lib/supabase'
import { estimateMissionPrice }  from '@/lib/missions/estimate-price'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const BATCH = 15   // borné : ORS ~40 req/min, chaque estimate = quelques routes

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()

  // Missions clôturées, sans facture Odoo, sans CA figé → à calculer.
  const { data: missions } = await sb.from('incoming_missions')
    .select('id, external_id, source, mission_type, vehicle_class, billed_to_id, billed_to_name, parked_at, storage_waived, incident_lat, incident_lng, destination_lat, destination_lng, snc_scenario, snc_requires_balisage, extra_addresses, intervention_date, received_at, special_tarif_htva, amount_to_collect, amount_guaranteed')
    .in('status', ['to_invoice', 'invoiced', 'completed'])
    .is('estimated_htva', null)
    .is('odoo_quote_id', null)
    .is('invoice_odoo_id', null)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(BATCH)

  let computed = 0, zero = 0
  const now = new Date().toISOString()
  for (const m of (missions || [])) {
    let htva = 0
    try {
      const est: any = await estimateMissionPrice(m as any)
      htva = est?.ok && Number(est.total_eur) > 0 ? Math.round(Number(est.total_eur) * 100) / 100 : 0
    } catch { htva = 0 }
    // On fige même 0 (estimated_htva_at) pour ne pas re-tenter en boucle.
    await sb.from('incoming_missions')
      .update({ estimated_htva: htva, estimated_htva_at: now })
      .eq('id', m.id).then(() => {}, () => {})
    if (htva > 0) computed++; else zero++
  }

  return NextResponse.json({ ok: true, processed: (missions || []).length, computed, zero, more: (missions || []).length >= BATCH })
}
