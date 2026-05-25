// src/app/api/missions/[id]/price-estimate/route.ts
//
// GET /api/missions/[id]/price-estimate
// Retourne l estimation tarifaire d une mission. 2 chemins :
//   - SNC / SC (police_snc / sia_couvert) : computeSncMetrics + buildSncQuoteLines
//     (calcul specifique : depots + balisage + plages MAJ horaires).
//   - Autres sources : estimateMissionPrice (source_tariffs + surcharges).
// Visible par tout user authentifie (dispatcher/admin) qui a acces a la mission.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { estimateMissionPrice } from '@/lib/missions/estimate-price'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: mission, error } = await sb
    .from('incoming_missions')
    .select(`
      id, source, mission_type, client_name, vehicle_mileage,
      parked_at, intervention_date, received_at, incident_type,
      parent_mission_id, amount_to_collect,
      incident_lat, incident_lng, destination_lat, destination_lng,
      snc_scenario, snc_requires_balisage,
      external_id, dossier_number
    `)
    .eq('id', params.id)
    .single()

  if (error || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // SNC / SC : calcul specifique via lib/snc/pricing
  // Olivier 2026-05-25 : "Une fois sur la fiche dispatch, l estimation tarif
  // en bas de page n est plus disponible" pour SNC.
  if ((mission.source === 'police_snc' || mission.source === 'sia_couvert')
      && (mission as any).snc_scenario) {
    try {
      const { computeSncMetrics, buildSncQuoteLines } = await import('@/lib/snc/pricing')
      const metrics = await computeSncMetrics({
        scenario:          (mission as any).snc_scenario,
        requiresBalisage:  Boolean((mission as any).snc_requires_balisage),
        interventionLat:   (mission as any).incident_lat,
        interventionLng:   (mission as any).incident_lng,
        destinationLat:    (mission as any).destination_lat,
        destinationLng:    (mission as any).destination_lng,
        interventionAt:    mission.intervention_date || mission.received_at,
      })
      if (!metrics) {
        return NextResponse.json({
          ok: false, source: mission.source, mission_type: mission.mission_type,
          pricing_mode: 'forfait', reason: 'SNC : depots non configures ou coordonnees invalides',
          forfait: null, km_charged: 0, km_inclus: 0, km_extra: 0, km_extra_eur: 0,
          parc_jours: 0, parc_eur: 0, subtotal_eur: 0, surcharge_pct: 0, surcharge_eur: 0,
          total_eur: 0, is_autofac: false, tariff_id: '', tariff_doc_path: null,
          tariff_doc_name: null, breakdown: [],
        })
      }
      const missionRef = mission.external_id || mission.dossier_number || `M-${mission.id.slice(0, 8)}`
      const variant = mission.source === 'sia_couvert' ? 'sc' : 'snc'
      const sncLines = buildSncQuoteLines({
        metrics,
        requiresBalisage: Boolean((mission as any).snc_requires_balisage),
        missionRef,
        variant,
      })
      const totalHtva = sncLines.reduce((s, l) => s + l.qty * l.price_unit, 0)
      // Format PriceEstimate compatible avec PriceEstimateCard
      return NextResponse.json({
        ok:            true,
        source:        mission.source,
        mission_type:  mission.mission_type || 'remorquage',
        pricing_mode:  'lines',
        forfait:       null,
        km_charged:    metrics.km_depanneuse || 0,
        km_inclus:     0,
        km_extra:      0,
        km_extra_eur:  0,
        parc_jours:    0,
        parc_eur:      0,
        subtotal_eur:  totalHtva,
        surcharge_pct: metrics.is_majored ? 50 : 0,
        surcharge_eur: 0,  // deja integre dans les prix majores
        total_eur:     totalHtva,
        is_autofac:    false,
        tariff_id:     `snc-${variant}`,
        tariff_doc_path: null,
        tariff_doc_name: null,
        breakdown: sncLines.map(l => ({
          label: l.name,
          amount: l.qty * l.price_unit,
          note: l.qty > 1 ? `${l.qty} × ${l.price_unit.toFixed(4)} €` : undefined,
        })),
      })
    } catch (e: any) {
      console.error('[price-estimate SNC]', e.message)
      // Fallback sur estimateMissionPrice (qui retournera probablement "no tariff")
    }
  }

  const estimate = await estimateMissionPrice(mission as any)
  return NextResponse.json(estimate)
}
