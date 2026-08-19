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
  // Appel interne (écran client) : x-internal-secret. Sinon session requise.
  const internalOk = !!process.env.NEXTAUTH_SECRET && req.headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET
  const session = internalOk ? null : await getServerSession(authOptions)
  if (!internalOk && !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: missionDb, error } = await sb
    .from('incoming_missions')
    .select(`
      id, source, mission_type, client_name, vehicle_mileage,
      parked_at, delivering_at, completed_at, intervention_date, received_at, incident_type, storage_waived,
      levee_saisie_date, temp_returned_at, domaine_remise_date,
      parent_mission_id, amount_to_collect, amount_guaranteed,
      incident_lat, incident_lng, destination_lat, destination_lng,
      snc_scenario, snc_requires_balisage,
      billed_to_id, billed_to_name, special_tarif_htva,
      extra_addresses,
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
    special_tarif_htva:      ovNum('special_tarif_htva')  ?? (missionDb as any).special_tarif_htva,
    parked_at:               ov('parked_at')              ?? (missionDb as any).parked_at,
    delivering_at:           ov('delivering_at')          ?? (missionDb as any).delivering_at,
  }

  // Olivier 2026-06-02 PM : tarif special HTVA → court-circuit total.
  // Une seule ligne SERV-DIV "Intervention suivant prix convenu" qui ECRASE
  // le calcul automatique (SNC, source_tariffs, etc.).
  if (mission.special_tarif_htva != null && Number(mission.special_tarif_htva) > 0) {
    const amount = Number(mission.special_tarif_htva)
    return NextResponse.json({
      ok:            true,
      source:        mission.source,
      mission_type:  mission.mission_type || 'autre',
      pricing_mode:  'special',
      forfait:       amount,
      km_charged:    0, km_inclus: 0, km_extra: 0, km_extra_eur: 0,
      parc_jours:    0, parc_eur: 0,
      subtotal_eur:  amount,
      surcharge_pct: 0, surcharge_eur: 0,
      total_eur:     amount,
      is_autofac:    false,
      tariff_id:     'special',
      tariff_doc_path: null, tariff_doc_name: null,
      special_tarif: true,
      breakdown: [
        { label: 'Intervention suivant prix convenu', amount, note: 'Tarif spécial HTVA défini par le dispatcher' },
      ],
    })
  }

  // Montant GARANTI = plafond facturable INDICATIF (ne force plus le tarif —
  // Olivier 2026-07-26). On le garde pour comparer au tarif calculé et lever un
  // warning si dépassé (cf plus bas). Seul amount_to_collect force encore.
  const guaranteed = (mission as any).amount_guaranteed != null && Number((mission as any).amount_guaranteed) > 0
    ? Number((mission as any).amount_guaranteed) : 0
  // amount_to_collect est un montant TVAC → on l'exprime en HTVA pour rester
  // cohérent avec le devis (cf build-quote-lines, fix 2026-06-17). Évite la
  // double TVA (TVAC TowSoft mis tel quel en HTVA).
  const toCollectTvac = mission.amount_to_collect != null && Number(mission.amount_to_collect) > 0
    ? Number(mission.amount_to_collect) : 0
  const toCollect = toCollectTvac > 0 ? Math.round((toCollectTvac / 1.21) * 10000) / 10000 : 0
  if (toCollect > 0) {
    return NextResponse.json({
      ok:            true,
      source:        mission.source,
      mission_type:  mission.mission_type || 'autre',
      pricing_mode:  'forced_amounts',
      forfait:       toCollect,
      km_charged:    0, km_inclus: 0, km_extra: 0, km_extra_eur: 0,
      parc_jours:    0, parc_eur: 0,
      subtotal_eur:  toCollect,
      surcharge_pct: 0, surcharge_eur: 0,
      total_eur:     toCollect,
      is_autofac:    false,
      tariff_id:     'forced_amounts',
      tariff_doc_path: null, tariff_doc_name: null,
      special_tarif: true,  // utilise par UI pour styler en amber
      guaranteed_eur:      guaranteed || undefined,
      guaranteed_exceeded: guaranteed > 0 && toCollect > guaranteed,
      breakdown: [{ label: 'Paiement à réclamer au client', amount: toCollect, note: `${toCollectTvac.toFixed(2)} € TVAC` }],
    })
  }

  // SNC / SC sans scenario : on retourne un message dedie au lieu de tomber
  // sur le fallback "tarif police_snc/depannage indisponible".
  // Olivier 2026-06-02 PM : le chauffeur choisit le scenario depuis sa fiche,
  // donc avant son choix on ne peut pas calculer le tarif precis.
  if ((mission.source === 'police_snc' || mission.source === 'sia_couvert')
      && !(mission as any).snc_scenario) {
    return NextResponse.json({
      ok: false,
      source: mission.source, mission_type: mission.mission_type || 'remorquage',
      reason: mission.source === 'sia_couvert'
        ? 'Siabis couvert : le chauffeur choisira le scénario (DSP / REM directe / REM dépôt) depuis sa fiche, le tarif sera calculé ensuite.'
        : 'Siabis non couvert : le chauffeur choisira le scénario (DSP / REM client / REM dépôt) depuis sa fiche, le tarif sera calculé ensuite.',
      forfait: null, km_charged: 0, km_inclus: 0, km_extra: 0, km_extra_eur: 0,
      parc_jours: 0, parc_eur: 0, subtotal_eur: 0, surcharge_pct: 0, surcharge_eur: 0,
      total_eur: 0, is_autofac: false, tariff_id: '', tariff_doc_path: null,
      tariff_doc_name: null, breakdown: [],
    })
  }

  // SNC / SC : calcul specifique via lib/snc/pricing
  // Olivier 2026-05-25 : "Une fois sur la fiche dispatch, l estimation tarif
  // en bas de page n est plus disponible" pour SNC.
  if ((mission.source === 'police_snc' || mission.source === 'sia_couvert')
      && (mission as any).snc_scenario) {
    try {
      const { computeSncMetrics, buildSncQuoteLines } = await import('@/lib/snc/pricing')
      // Stops chauffeur (extra_addresses) : ordonnes par sort_order
      const rawStops = Array.isArray((missionDb as any).extra_addresses) ? (missionDb as any).extra_addresses : []
      const stops    = [...rawStops].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((s: any) => ({ lat: s.lat, lng: s.lng, label: s.label || s.address }))
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
        stops,
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
      // Olivier 2026-06-02 PM : le gardiennage ne se calcule QU EN CAS de
      // passage en depot. Pas de parked_at = pas de gardiennage. Pas de
      // fallback received_at (anciennement c etait un bug pour rem_direct /
      // rem_client qui n ont pas de passage parc et se voyaient factures
      // des jours de gardiennage fictifs depuis la reception).
      //
      // Cas particulier : 'intervention_date' (Mal Garee) compte depuis
      // l intervention meme si pas formellement parked_at, car la voiture
      // est "en attente sur la voirie" → tarif de gardiennage applicable.
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
        // Date de debut : intervention_date (Mal Garee) OU parked_at strict (autres).
        // PAS de fallback received_at — si pas parked_at sur les autres modes,
        // c est que le vehicule n est jamais passe par le parc.
        const refSource = parcLine.parc_count_from === 'intervention_date'
          ? (mission.intervention_date || mission.received_at)
          : mission.parked_at  // strict : null si pas passe en parc
        if (refSource) {
          // Date de fin : sortie effective (delivering_at) > completed_at >
          // aujourd hui (encore en parc). Le vehicule ne genere du gardiennage
          // QUE pendant son sejour reel.
          const refEnd = (mission as any).delivering_at
                       || (mission as any).completed_at
                       || new Date().toISOString()
          const diffMs = Math.max(0, new Date(refEnd).getTime() - new Date(refSource).getTime())
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

      const breakdown: any[] = sncLines.map(l => ({
        label: l.name,
        amount: l.qty * l.price_unit,
        note: l.qty > 1 ? `${l.qty} × ${l.price_unit.toFixed(4)} €` : undefined,
      }))
      // Olivier 2026-06-02 PM : detail visuel des elements pris en compte
      // pour le calcul (depot, segments km, plage horaire, assistance, scenario).
      // Permet au dispatcher de controler que tout est coherent.
      const calcInfo: any[] = []
      calcInfo.push({
        label:  `📍 Dépôt de calcul : ${metrics.depart_depot}`,
        amount: null,
        note:   `Le plus proche par route (Google Maps). Différent du "Dépôt de départ" en haut de fiche (gardiennage).`,
      })
      if ((metrics as any).balisage_depot) {
        calcInfo.push({
          label:  `🚧 Dépôt balisage : ${(metrics as any).balisage_depot}`,
          amount: null,
          note:   `Le plus proche par route entre Pepinster et Aywaille.`,
        })
      }
      calcInfo.push({
        label:  `🎯 Scénario : ${(mission as any).snc_scenario}`,
        amount: null,
        note:   `Variant ${variant === 'sc' ? 'SC (Siabis couvert — facturation assistance)' : 'SNC (Siabis non couvert — paiement client/dépôt)'}`,
      })
      if (metrics.is_majored) {
        calcInfo.push({
          label:  `🌙 Plage horaire majorée`,
          amount: null,
          note:   `L intervention tombe dans une plage de majoration configurée dans /admin/surcharges.`,
        })
      }
      if ((metrics as any).livraison_assistance) {
        calcInfo.push({
          label:  `🏷 Assistance facturée : ${(metrics as any).livraison_assistance}`,
          amount: null,
          note:   `Tarif km utilisé : ${((metrics as any).livraison_km_price ?? 0).toFixed(4)} €/km, ${(metrics as any).livraison_km_inclus ?? 0} km inclus dans son forfait.`,
        })
      }
      // Segments km
      if (Array.isArray((metrics as any).km_segments) && (metrics as any).km_segments.length > 0) {
        for (const seg of (metrics as any).km_segments) {
          calcInfo.push({
            label:  `🛣 ${seg.label}`,
            amount: null,
            note:   `${seg.km} km (route Google)`,
          })
        }
        const totalSnc  = metrics.km_depanneuse
        const totalLiv  = (metrics as any).km_livraison
        const totalBal  = metrics.km_balisage
        calcInfo.push({
          label:  `Σ Totaux`,
          amount: null,
          note:   `Dépanneuse ${totalSnc} km${totalLiv ? ` · Livraison ${totalLiv} km` : ''}${totalBal > 0 ? ` · Balisage ${totalBal} km` : ''}`,
        })
      }
      // calcInfo en premier, puis lignes facturables
      breakdown.unshift(...calcInfo)
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
        // Postes dépannage sélectionnables (facture partielle) — mêmes lignes
        // que la facturation SNC complète. Olivier 2026-07-28.
        template_lines: sncLines.map(l => ({ kind: l.kind, name: l.name, default_qty: l.qty, default_price: l.price_unit })),
        breakdown,
      })
    } catch (e: any) {
      console.error('[price-estimate SNC]', e.message)
      // Fallback sur estimateMissionPrice (qui retournera probablement "no tariff")
    }
  }

  const estimate = await estimateMissionPrice(mission as any)
  // Montant garanti = plafond indicatif : on n'écrase PAS le tarif calculé, mais
  // on signale s'il le dépasse (warning UI). Olivier 2026-07-26.
  const estTotal = Number((estimate as any).total_eur ?? 0)
  return NextResponse.json({
    ...estimate,
    guaranteed_eur:      guaranteed || undefined,
    guaranteed_exceeded: guaranteed > 0 && (estimate as any).ok !== false && estTotal > guaranteed,
  })
}
