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
  const { data: missionDb, error } = await sb
    .from('incoming_missions')
    .select(`
      id, source, mission_type, client_name, vehicle_mileage,
      parked_at, intervention_date, received_at, incident_type,
      parent_mission_id, amount_to_collect,
      incident_lat, incident_lng, destination_lat, destination_lng,
      snc_scenario, snc_requires_balisage,
      billed_to_id, billed_to_name,
      external_id, dossier_number
    `)
    .eq('id', params.id)
    .single()

  if (error || !missionDb) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Olivier 2026-06-02 : pour l estimation live cote dispatch, on accepte des
  // overrides via query params. Permet au PriceEstimateCard de refleter le
  // form en cours d edition (mission_type, source, snc_scenario…) sans
  // attendre la sauvegarde + refresh.
  const url = new URL(req.url)
  const ov = (k: string) => {
    const v = url.searchParams.get(k)
    return v != null && v !== '' ? v : undefined
  }
  const ovNum = (k: string) => {
    const v = url.searchParams.get(k)
    if (v == null || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const ovBool = (k: string) => {
    const v = url.searchParams.get(k)
    if (v == null) return undefined
    return v === '1' || v === 'true'
  }
  const mission = {
    ...missionDb,
    source:                  ov('source')                 ?? missionDb.source,
    mission_type:            ov('mission_type')           ?? missionDb.mission_type,
    snc_scenario:            ov('snc_scenario')           ?? (missionDb as any).snc_scenario,
    snc_requires_balisage:   ovBool('snc_requires_balisage') ?? (missionDb as any).snc_requires_balisage,
    incident_lat:            ovNum('incident_lat')        ?? missionDb.incident_lat,
    incident_lng:            ovNum('incident_lng')        ?? missionDb.incident_lng,
    destination_lat:         ovNum('destination_lat')     ?? missionDb.destination_lat,
    destination_lng:         ovNum('destination_lng')     ?? missionDb.destination_lng,
    billed_to_id:            ovNum('billed_to_id')        ?? (missionDb as any).billed_to_id,
    billed_to_name:          ov('billed_to_name')         ?? (missionDb as any).billed_to_name,
  }

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
        variant:           mission.source === 'sia_couvert' ? 'sc' : 'snc',
        billedToId:        (mission as any).billed_to_id,
        billedToName:      (mission as any).billed_to_name,
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
      const depannageTotal = sncLines.reduce((s, l) => s + l.qty * l.price_unit, 0)

      // Olivier 2026-05-28 : le SNC ne calculait pas le gardiennage du tout.
      // On va chercher la ligne SERV-PARC configuree pour cette source dans
      // source_tariff_lines, et on calcule les jours auto depuis parked_at
      // (fallback received_at pour les missions legacy sans parked_at).
      // Olivier 2026-05-28 :
      // - Jour d arrivee jamais compte (Math.floor : jours pleins ecoules).
      // - Reference de depart selon parc_count_from (parked_at par defaut,
      //   intervention_date pour Mal Garee).
      // - free_days = jours offerts (SC = 3, autres = 0).
      let parcJoursElapsed = 0
      let parcFreeDays     = 0
      let parcJours        = 0
      let parcPrixJour     = 0
      let parcLineLabel    = 'Frais de gardiennage (par jour)'
      let parcRefLabel     = 'mise en parc'
      const today = new Date().toISOString().slice(0, 10)
      const { data: parcLines } = await sb
        .from('source_tariff_lines')
        .select('name, default_price, effective_to, free_days, parc_count_from')
        .eq('source', mission.source)
        .eq('kind', 'SERV-PARC')
        .lte('effective_from', today)
      const parcLine = (parcLines || []).find(l => !l.effective_to || l.effective_to >= today)
      if (parcLine && parcLine.default_price != null) {
        const refSource = parcLine.parc_count_from === 'intervention_date'
          ? (mission.intervention_date || mission.received_at)
          : (mission.parked_at         || mission.received_at)
        if (refSource) {
          const diffMs = Math.max(0, Date.now() - new Date(refSource).getTime())
          parcJoursElapsed = Math.floor(diffMs / (1000 * 60 * 60 * 24))
          parcFreeDays     = Number(parcLine.free_days || 0)
          parcJours        = Math.max(0, parcJoursElapsed - parcFreeDays)
          parcPrixJour     = Number(parcLine.default_price)
          parcLineLabel    = parcLine.name || parcLineLabel
          parcRefLabel     = parcLine.parc_count_from === 'intervention_date' ? 'intervention' : 'mise en parc'
        }
      }
      const parcEur   = parcJours * parcPrixJour
      const totalHtva = depannageTotal + parcEur

      const breakdown = sncLines.map(l => ({
        label: l.name,
        amount: l.qty * l.price_unit,
        note: l.qty > 1 ? `${l.qty} × ${l.price_unit.toFixed(4)} €` : undefined,
      }))
      if (parcPrixJour > 0) {
        let note: string
        if (parcFreeDays > 0) {
          note = parcJours > 0
            ? `${parcJours} jour(s) facturable(s) × ${parcPrixJour.toFixed(2)} € (${parcJoursElapsed} j. depuis ${parcRefLabel} – ${parcFreeDays} offert(s))`
            : `${parcJoursElapsed} j. depuis ${parcRefLabel}, encore dans la période de ${parcFreeDays} jour(s) offert(s)`
        } else {
          note = parcJours > 0
            ? `${parcJours} jour(s) × ${parcPrixJour.toFixed(2)} € (depuis ${parcRefLabel}, jour d'arrivée non compté)`
            : `${parcPrixJour.toFixed(2)} €/jour (jour d'arrivée non compté)`
        }
        breakdown.push({ label: parcLineLabel, amount: parcEur, note })
      }

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
        parc_jours:    parcJours,
        parc_eur:      parcEur,
        subtotal_eur:  totalHtva,
        surcharge_pct: metrics.is_majored ? 50 : 0,
        surcharge_eur: 0,
        total_eur:     totalHtva,
        is_autofac:    false,
        tariff_id:     `snc-${variant}`,
        tariff_doc_path: null,
        tariff_doc_name: null,
        breakdown,
      })
    } catch (e: any) {
      console.error('[price-estimate SNC]', e.message)
      // Fallback sur estimateMissionPrice (qui retournera probablement "no tariff")
    }
  }

  const estimate = await estimateMissionPrice(mission as any)
  return NextResponse.json(estimate)
}
