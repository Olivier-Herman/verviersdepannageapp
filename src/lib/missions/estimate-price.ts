// src/lib/missions/estimate-price.ts
//
// Helper pour estimer le prix d'une mission selon :
//   - le tarif source_tariffs en vigueur (source + mission_type)
//   - la distance parcourue (si applicable)
//   - les majorations contextuelles (nuit/WE/JF) via getApplicableSurcharges
//
// Retourne un breakdown structure utilisable cote UI.

import { createAdminClient } from '@/lib/supabase'
import { getApplicableSurcharges, isBelgianHoliday } from '@/lib/surcharges'
import { normalizeType, isRemorquage, isDsp, isTrajetVide, isRelivraison, isRemRel } from '@/lib/missions/mission-types'

/**
 * Determine si une date/heure tombe dans la plage "majorée" IPA :
 *   - heure < 7 OU heure >= 18
 *   - OU samedi/dimanche
 *   - OU jour férié BE
 * Utilise l heure LOCALE Belgique (timezone Europe/Brussels).
 */
function isIpaMajoredHour(date: Date): boolean {
  // Reuse de la logique belgianParts via Intl pour avoir l heure locale BE
  const isoLocal = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Brussels',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
  const [datePart, timePart] = isoLocal.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour] = timePart.split(':').map(Number)

  // Heure majoree
  if (hour < 7 || hour >= 18) return true

  // Weekend (samedi=6, dimanche=0 cote JS UTC ; on prend midi local pour eviter
  // les ambiguites DST sur les minuits)
  const refUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const jsDay = refUtc.getUTCDay()  // 0=Dim..6=Sam
  if (jsDay === 0 || jsDay === 6) return true

  // Jour ferie BE
  if (isBelgianHoliday(date)) return true

  return false
}

const GMAPS_KEY = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

type Coord = { lat: number; lng: number }

async function routesDistanceKm(origin: Coord, destination: Coord): Promise<number | null> {
  if (!GMAPS_KEY) return null
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   GMAPS_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters',
      },
      body: JSON.stringify({
        origin:           { location: { latLng: { latitude: origin.lat,      longitude: origin.lng      } } },
        destination:      { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode:       'DRIVE',
        routingPreference:'TRAFFIC_UNAWARE',
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const meters = data.routes?.[0]?.distanceMeters
    return typeof meters === 'number' ? meters / 1000 : null
  } catch {
    return null
  }
}

/**
 * Calcule deux notions de km pour une mission :
 *   - chargedKm : segments incident → stops → destination (véhicule du client sur le plateau).
 *                 Utilisé par les assurances (VAB, Touring, etc.) qui ne paient que le chargé.
 *   - totalKm   : depot → incident → stops → destination → retour depot.
 *                 Utilisé par les missions "autre" / privé / garage qui facturent tout.
 *
 * Pour DSP / réparation sur place / trajet_vide : pas de chargé, totalKm = aller/retour depot.
 */
async function computeMissionKm(missionId: string): Promise<{ chargedKm: number | null; totalKm: number | null }> {
  const sb = createAdminClient()
  const { data: m } = await sb
    .from('incoming_missions')
    .select('mission_type, incident_lat, incident_lng, destination_lat, destination_lng, extra_addresses, depot_depart_id')
    .eq('id', missionId)
    .maybeSingle()
  if (!m) return { chargedKm: null, totalKm: null }

  if (m.incident_lat == null || m.incident_lng == null) return { chargedKm: null, totalKm: null }
  const incident: Coord = { lat: Number(m.incident_lat), lng: Number(m.incident_lng) }

  // Depot : celui de la mission ou le defaut
  let depot: Coord | null = null
  if (m.depot_depart_id) {
    const { data: d } = await sb.from('depots').select('lat, lng').eq('id', m.depot_depart_id).maybeSingle()
    if (d?.lat != null && d.lng != null) depot = { lat: Number(d.lat), lng: Number(d.lng) }
  }
  if (!depot) {
    const { data: d } = await sb.from('depots').select('lat, lng').eq('is_default', true).eq('active', true).maybeSingle()
    if (d?.lat != null && d.lng != null) depot = { lat: Number(d.lat), lng: Number(d.lng) }
  }

  // Stops intermediaires
  const rawStops: any[] = Array.isArray(m.extra_addresses) ? m.extra_addresses : []
  const stops: Coord[] = [...rawStops]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .filter(s => s.lat != null && s.lng != null)
    .map(s => ({ lat: Number(s.lat), lng: Number(s.lng) }))

  const destinationCoord: Coord | null = m.destination_lat != null && m.destination_lng != null
    ? { lat: Number(m.destination_lat), lng: Number(m.destination_lng) }
    : null

  const type = (m.mission_type || '').toLowerCase()
  const isNonTow = isDsp(type) || isTrajetVide(type)

  // Charged = segments avec le vehicule du client (incident → stops → destination)
  let chargedKm: number | null
  if (isNonTow) {
    chargedKm = 0
  } else {
    const chain: Coord[] = [incident, ...stops]
    if (destinationCoord) chain.push(destinationCoord)
    if (chain.length < 2) {
      chargedKm = 0
    } else {
      let acc = 0
      let ok = true
      for (let i = 0; i < chain.length - 1; i++) {
        const km = await routesDistanceKm(chain[i], chain[i + 1])
        if (km == null) { ok = false; break }
        acc += km
      }
      chargedKm = ok ? acc : null
    }
  }

  // Total = depot → incident → stops → (destination | retour depot pour DSP)
  let totalKm: number | null
  if (!depot) {
    totalKm = null
  } else {
    const chain: Coord[] = [depot, incident, ...stops]
    if (destinationCoord && !isNonTow) chain.push(destinationCoord)
    chain.push(depot)  // retour depot
    let acc = 0
    let ok = true
    for (let i = 0; i < chain.length - 1; i++) {
      const km = await routesDistanceKm(chain[i], chain[i + 1])
      if (km == null) { ok = false; break }
      acc += km
    }
    totalKm = ok ? acc : null
  }

  return {
    chargedKm: chargedKm != null ? Math.round(chargedKm * 10) / 10 : null,
    totalKm:   totalKm   != null ? Math.round(totalKm   * 10) / 10 : null,
  }
}

export interface TemplateLine {
  kind:             'SERV-PEC' | 'SERV-KM' | 'SERV-PARC' | 'SERV-MAJ' | 'SERV-DIV'
  name:             string
  default_qty:      number | null
  default_price:    number | null
  apply_surcharges: boolean
  // SERV-PARC : période (ISO) qui compose le décompte de jours (affichage estimation).
  parc_from?:       string | null
  parc_to?:         string | null
}

export interface PriceEstimate {
  ok:            boolean
  reason?:       string  // si pas de tarif trouve
  source:        string  // source utilisee pour le lookup
  mission_type:  string  // type canonical
  pricing_mode:  'forfait' | 'brackets' | 'lines'
  forfait:       number | null
  km_charged:    number  // km charges (incident -> destination, sans depot ni retour)
  km_inclus:     number
  km_extra:      number  // max(0, km_charged - km_inclus)
  km_extra_eur:  number  // km_extra * km_price
  parc_jours:    number
  parc_eur:      number
  subtotal_eur:  number  // forfait + km_extra_eur + parc_eur
  surcharge_pct: number  // % de majoration applicable (0 si rien)
  surcharge_eur: number  // subtotal * surcharge_pct / 100
  total_eur:     number  // subtotal + surcharge_eur
  // Olivier 2026-05-27 (Fix C) : TVAC exact si l user a saisi un forfait TVAC.
  // Evite la derive d arrondi flottant lors d un aller-retour HT*1.21.
  // Quand present, le frontend affiche cette valeur telle quelle pour le TVAC.
  total_tvac_exact?: number
  is_autofac:    boolean // si autofacturation (info pour dispatcher)
  tariff_id:     string  // id du source_tariff utilise
  tariff_doc_path: string | null
  tariff_doc_name: string | null
  breakdown:     { label: string; amount: number | null; note?: string }[]
  // Mode 'lines' uniquement : lignes pre-configurees a editer cote UI
  template_lines?: TemplateLine[]
}

interface MissionLike {
  id?:                string
  source:             string | null
  mission_type:       string | null
  client_name:        string | null
  vehicle_mileage:    number | null
  parked_at?:         string | null
  delivering_at?:     string | null
  completed_at?:      string | null
  intervention_date?: string | null
  received_at?:       string | null
  // Police Saisie (Olivier 2026-06-13) : la date de levée sépare le gardiennage
  // Parquet (avant) du gardiennage hors période saisie (après, 20 €/j).
  // temp_returned_at = retour en parc après levée temporaire (départ du
  // décompte hors période dans ce cas).
  levee_saisie_date?: string | null
  temp_returned_at?:  string | null
  // Remise au Domaine (État) : la date de remise borne la période facturable au
  // client/parquet (le gardiennage parquet s'arrête là). Les jours remise->vente
  // sont facturés à l'État séparément (Excel trimestriel), pas dans cette estimation.
  domaine_remise_date?: string | null
  incident_type?:     string | null
  parent_mission_id?: string | null
  // Toggle Voiture/Moto : 'car' (default) ou 'moto'. Permet de selectionner
  // une grille tarifaire specifique (notamment Police Accident PCD vs PC).
  vehicle_class?:     string | null
  // Override pour preview cote dispatch (avant insertion BDD) : si fourni,
  // bypass computeMissionKm qui exige un mission.id existant.
  // distance_km : LEGACY, meme valeur pour charged et total.
  // total_km / charged_km : NOUVEAU (Olivier 2026-05-25). total_km =
  // boucle complete depot -> incident -> stops -> retour depot.
  // charged_km = incident -> stops -> derniere destination.
  // Si total_km ou charged_km est fourni, ils prennent le pas sur distance_km.
  distance_km?:       number | null
  total_km?:          number | null
  charged_km?:        number | null
  // Appel Prive (source='prive') : forfait TVAC saisi par dispatcher/chauffeur.
  // Si rempli, on facture une seule ligne au montant HT = TVAC/1.21.
  // Si vide, on bascule le calcul sur le tarif 'police_accident' avec ses
  // majorations horaires (la source originale 'prive' reste preservee pour
  // le tracking et le naming des lignes).
  amount_to_collect?: number | null
}

/** Map mission_type DB vers le canonical attendu en source_tariffs (lowercase). */
function canonicalType(t: string | null): string | null {
  // Olivier 2026-05-28 :
  // - REL = mission enfant de relivraison (vehicule en parc -> client). A son
  //   propre tarif source/relivraison configurable dans /admin/tarifs.
  // - REM+REL = mission parente (remorquage avec etape parc, REL prevue ensuite).
  //   Reste facturee au tarif REM (le remorquage initial est la facture du
  //   parent ; la relivraison est facturee separement sur la fiche REL enfant).
  if (isRelivraison(t)) return 'relivraison'
  if (isRemRel(t))      return 'remorquage'
  if (isRemorquage(t))  return 'remorquage'
  if (isDsp(t))         return 'depannage'
  if (isTrajetVide(t))  return 'trajet_vide'
  if (!t) return null
  return normalizeType(t)
}

export async function estimateMissionPrice(mission: MissionLike): Promise<PriceEstimate> {
  const source = (mission.source || '').toLowerCase().trim()
  const missionType = canonicalType(mission.mission_type)

  if (!source || !missionType) {
    return emptyEstimate(source, missionType || 'inconnu', 'Source ou type mission manquant')
  }

  // === MISSION REL (relivraison) ===
  // Olivier 2026-05-28 : tarif par defaut = on refacture uniquement les km
  // parcourus, au tarif km de la source. Pas de km inclus, pas de prise en
  // charge, pas de treuil. Le tarif km est lu en priorite depuis la grille
  // source_tariff_lines (kind=SERV-KM) configuree pour cette source (memes
  // valeurs que pour la REM). Fallback : source_tariffs.km_extra_price.
  if (missionType === 'relivraison') {
    return await estimateRelivraisonPrice(mission, source)
  }

  // === OVERRIDE FORFAIT NEGOCIE (toute source) ===
  // Si le dispatcher a saisi un amount_to_collect (TVAC) lors de la creation,
  // ce forfait remplace TOUT le calcul tarifaire (1 seule ligne "Forfait
  // negocie"). S applique aux Appels Prive, Police Accident, Mal Garee, etc.
  // — partout ou le dispatcher peut negocier un montant direct avec le client.
  // Olivier 2026-05-28 : avant, override seulement pour 'prive', ce qui faisait
  // afficher en parallele le calcul police complet + le forfait en TVAC =
  // incoherence (HTVA 427.85 € + TVAC 250 €).
  const amountTvac = mission.amount_to_collect != null && Number(mission.amount_to_collect) > 0
    ? Number(mission.amount_to_collect)
    : null

  if (amountTvac != null) {
    // Olivier 2026-06-03 : 4 décimales pour que HTVA × 1.21 = TVAC exact.
    // Avec 2 décimales : 125/1.21 = 103.31 → ×1.21 = 125.0051 → arrondi 125.01 (bug).
    // Avec 4 décimales : 125/1.21 = 103.3058 → ×1.21 = 125.0000 → 125.00 OK.
    // Requiert que Odoo "Decimal Precision > Product Price" soit configure a 4.
    const amountHt = Math.round((amountTvac / 1.21) * 10000) / 10000
    return {
      ok:            true,
      source,
      mission_type:  missionType,
      pricing_mode:  'forfait',
      forfait:       amountHt,
      km_charged:    0,
      km_inclus:     0,
      km_extra:      0,
      km_extra_eur:  0,
      parc_jours:    0,
      parc_eur:      0,
      subtotal_eur:  amountHt,
      surcharge_pct: 0,
      surcharge_eur: 0,
      total_eur:     amountHt,
      // Olivier 2026-05-27 (Fix C) : amount TVAC exact saisi par l user.
      // Evite l aller-retour HT*1.21 qui derive (103.31 * 1.21 = 125.0051 -> 125.01 KO).
      total_tvac_exact: amountTvac,
      is_autofac:    false,
      tariff_id:     `${source}-forfait-negocie`,
      tariff_doc_path: null,
      tariff_doc_name: null,
      breakdown: [
        { label: 'Forfait négocié', amount: amountHt, note: `${amountTvac.toFixed(2)} € TVAC saisi à la création (remplace le tarif ${source})` },
      ],
    }
  }

  // === SOURCE 'prive' (Appel Privé) — fallback sans forfait ===
  // Pas de forfait saisi -> on bascule sur le tarif police_accident
  // (avec ses majorations horaires). La source originale 'prive' reste
  // preservee dans l estimate retourne pour le tracking.
  if (source === 'prive') {
    const fallback = await estimateMissionPrice({ ...mission, source: 'police_accident' })
    return {
      ...fallback,
      source: 'prive',
      breakdown: [
        ...fallback.breakdown,
        { label: 'Tarif appliqué', amount: null, note: 'Aucun forfait négocié → tarif Appel Police Accident' },
      ],
    }
  }

  const sb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const vehicleClass = (mission.vehicle_class || 'car').toLowerCase()

  // 1. Lookup le tarif en vigueur (effective_from <= today, effective_to >= today ou null).
  //    Filtrage par vehicle_class :
  //      - une grille avec vehicle_class qui match la mission prime sur la generique
  //      - une grille avec vehicle_class IS NULL est generique (s applique a tous)
  //    Tri : vehicle_class non-null d abord (specifique > generique), puis effective_from DESC.
  //
  // Note 2026-05-25 : on filtre vehicle_class et effective_to en JS apres
  // requete car chainer deux .or() dans Supabase JS v2 genere ?or=(...)&or=(...)
  // mal interprete par PostgREST (les conditions s annulent ou s ecrasent).
  // Cf bug observe sur source_tariff_lines (lookup retournait 0 lignes au lieu
  // de 6 pour police_accident).
  const { data: tariffsRaw } = await sb
    .from('source_tariffs')
    .select('*')
    .eq('source', source)
    .eq('mission_type', missionType)
    .lte('effective_from', today)
    .order('vehicle_class', { ascending: false, nullsFirst: false })
    .order('effective_from', { ascending: false })

  const tariffsFiltered = (tariffsRaw || []).filter(t => {
    const vehicleOk     = !t.vehicle_class || t.vehicle_class === vehicleClass
    const effectiveToOk = !t.effective_to  || t.effective_to >= today
    return vehicleOk && effectiveToOk
  })
  const tariff = tariffsFiltered[0]
  if (!tariff) {
    return emptyEstimate(source, missionType, `Aucun tarif ${source}/${missionType} en vigueur`)
  }

  // Branche "brackets" (IPA) : tarif par tranche de km, majoration horaire integree.
  if (tariff.pricing_mode === 'brackets') {
    return estimateBrackets(mission, source, missionType, tariff, sb)
  }

  // Branche "lines" : lignes pre-configurees (template). L app remplit les
  // defauts, l employe ajuste les qty/PU avant push.
  if (tariff.pricing_mode === 'lines') {
    return estimateLinesTemplate(mission, source, missionType, tariff, sb)
  }

  // 2. Calcul forfait + km extra
  //    Le tarif spec quelle base de km utiliser (km_basis) :
  //      - 'charged' (default) : incident → destination (assurances)
  //      - 'total'             : depot → incident → ... → retour depot (priv/garage)
  const forfait = Number(tariff.unit_price || 0)
  const kmBasis: 'charged' | 'total' = tariff.km_basis === 'total' ? 'total' : 'charged'
  let kmCharged = 0
  let kmTotalRoute = 0
  if (mission.total_km != null || mission.charged_km != null) {
    // Preview cote dispatch (Olivier 2026-05-25) : valeurs separees calculees
    // via Google DirectionsService cote UI (waypoints geres). Fallback entre
    // les 2 si une seule est fournie.
    kmCharged    = mission.charged_km ?? mission.total_km ?? 0
    kmTotalRoute = mission.total_km   ?? mission.charged_km ?? 0
  } else if (mission.distance_km != null) {
    // LEGACY : meme valeur pour charged et total (approximation acceptable).
    kmCharged    = mission.distance_km
    kmTotalRoute = mission.distance_km
  } else if (mission.id) {
    const km = await computeMissionKm(mission.id)
    kmCharged    = km.chargedKm ?? 0
    kmTotalRoute = km.totalKm   ?? 0
  }
  const kmBase = kmBasis === 'total' ? kmTotalRoute : kmCharged
  const kmInclus = Number(tariff.km_inclus || 0)
  // Km supplementaires arrondis a l unite superieure (pas de decimales sur les
  // quantites facturables : "12,4 km extras" devient "13 km")
  const kmExtra = Math.ceil(Math.max(0, kmBase - kmInclus))
  const kmExtraEur = kmExtra * Number(tariff.km_price || 0)

  // 3. Calcul parc si parked_at est set
  let parcJours = 0
  let parcEur = 0
  // Olivier 2026-06-02 PM : gardiennage UNIQUEMENT si passage en parc
  // (parked_at non null). Date de fin = sortie effective (delivering_at)
  // > cloture (completed_at) > aujourd hui (encore en parc).
  // Math.floor : jour d arrivee non compte (jours pleins ecoules).
  if (mission.parked_at && tariff.parc_day_price) {
    const parcStart = new Date(mission.parked_at)
    const refEnd    = (mission as any).delivering_at
                   || (mission as any).completed_at
                   || new Date().toISOString()
    const parcEnd   = new Date(refEnd)
    const diffMs    = Math.max(0, parcEnd.getTime() - parcStart.getTime())
    parcJours       = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    parcEur         = parcJours * Number(tariff.parc_day_price || 0)
  }

  let subtotal = forfait + kmExtraEur + parcEur

  // 3b. Appliquer les regles dynamiques (tariff_rules) qui matchent
  const interventionDateStr2 = mission.intervention_date || mission.received_at
  const interventionYmd = interventionDateStr2 ? new Date(interventionDateStr2).toISOString().slice(0, 10) : null

  let rulesQuery = sb
    .from('tariff_rules')
    .select('*')
    .eq('active', true)
    .order('priority')
  const { data: rulesAll } = await rulesQuery
  const matchingRules: any[] = []
  for (const r of rulesAll || []) {
    if (r.filter_source       && r.filter_source       !== source) continue
    if (r.filter_mission_type && r.filter_mission_type !== missionType) continue
    if (r.filter_date_from && interventionYmd && interventionYmd < r.filter_date_from) continue
    if (r.filter_date_to   && interventionYmd && interventionYmd > r.filter_date_to)   continue
    if (r.filter_client_name && mission.client_name
        && !mission.client_name.toLowerCase().includes(String(r.filter_client_name).toLowerCase())) continue
    matchingRules.push(r)
  }

  const rulesBreakdown: { label: string; amount: number | null; note?: string }[] = []
  for (const rule of matchingRules) {
    let delta = 0
    if (rule.operation_type === 'add_fixed') {
      delta = Number(rule.operation_value || 0)
    } else if (rule.operation_type === 'add_pct') {
      delta = subtotal * Number(rule.operation_value || 0) / 100
    } else if (rule.operation_type === 'set_fixed') {
      delta = Number(rule.operation_value || 0) - subtotal
    }
    subtotal += delta
    rulesBreakdown.push({
      label: `Règle: ${rule.reason || rule.description?.slice(0, 50) || 'sans nom'}`,
      amount: delta,
      note: rule.operation_type === 'add_fixed' ? `+${Number(rule.operation_value).toFixed(2)} €`
          : rule.operation_type === 'add_pct'   ? `+${rule.operation_value}%`
          : `= ${Number(rule.operation_value).toFixed(2)} €`,
    })
  }

  // 4. Majorations via module surcharges
  let surchargePct = 0
  let surchargeNote = ''
  const interventionDateStr = mission.intervention_date || mission.received_at
  if (interventionDateStr) {
    const interventionDate = new Date(interventionDateStr)
    try {
      const applicable = await getApplicableSurcharges({
        source: mission.source,
        client_name: mission.client_name,
        mission_type: mission.mission_type,
        incident_type: mission.incident_type || null,
        parent_mission_id: mission.parent_mission_id || null,
      }, interventionDate)
      if (applicable.length > 0) {
        // Cumul des taux applicables (en general 1 seul mais on cumule par safety)
        surchargePct = applicable.reduce((sum, s) => sum + Number(s.rate_pct || 0), 0)
        surchargeNote = applicable.map(s => `${s.weekday_label} ${s.range_label} +${s.rate_pct}%`).join(', ')
      }
    } catch (e: any) {
      console.warn('[estimate-price] surcharges error (non bloquant):', e.message)
    }
  }

  const surchargeEur = (subtotal * surchargePct) / 100
  const total = subtotal + surchargeEur

  const kmBasisLabel = kmBasis === 'total' ? 'km totaux' : 'km chargés'
  const breakdown = [
    { label: 'Forfait',   amount: forfait, note: kmInclus > 0 ? `${kmInclus} km inclus` : undefined },
    { label: `Km extra (${kmBasisLabel})`, amount: kmExtraEur > 0 ? kmExtraEur : null, note: kmExtra > 0 ? `${kmExtra} km × ${Number(tariff.km_price || 0).toFixed(2)} €` : `base : ${kmBase} km` },
    { label: 'Parc',      amount: parcEur > 0 ? parcEur : null, note: parcJours > 0 ? `${parcJours} jour(s) × ${Number(tariff.parc_day_price || 0).toFixed(2)} €` : 'non applicable' },
    ...rulesBreakdown,
    { label: 'Majoration horaire', amount: surchargeEur > 0 ? surchargeEur : null, note: surchargeNote || 'aucune' },
  ]

  return {
    ok:            true,
    source,
    mission_type:  missionType,
    pricing_mode:  'forfait',
    forfait,
    km_charged:    kmBase,
    km_inclus:     kmInclus,
    km_extra:      kmExtra,
    km_extra_eur:  kmExtraEur,
    parc_jours:    parcJours,
    parc_eur:      parcEur,
    subtotal_eur:  subtotal,
    surcharge_pct: surchargePct,
    surcharge_eur: surchargeEur,
    total_eur:     total,
    is_autofac:    Boolean(tariff.is_autofac),
    tariff_id:     tariff.id,
    tariff_doc_path: tariff.source_document_path,
    tariff_doc_name: tariff.source_document_name,
    breakdown,
  }
}

/**
 * Branche tarification "brackets" (IPA = AXA + Ardenne Prevoyante) :
 * lookup par tranche de km + selection prix normal/majore selon heure d appel.
 * Km utilises = totalKm (depot -> ... -> retour depot) par defaut (km_basis='total').
 * Au-dela de beyond_max_km : prix bracket max + steps * beyond_max_step_price.
 */
async function estimateBrackets(
  mission:     MissionLike,
  source:      string,
  missionType: string,
  tariff:      any,
  sb:          ReturnType<typeof createAdminClient>,
): Promise<PriceEstimate> {
  // 1. km de la mission (charged ou total selon km_basis)
  const kmBasis: 'charged' | 'total' = tariff.km_basis === 'total' ? 'total' : 'charged'
  let kmCharged = 0
  let kmTotalRoute = 0
  if (mission.total_km != null || mission.charged_km != null) {
    kmCharged    = mission.charged_km ?? mission.total_km ?? 0
    kmTotalRoute = mission.total_km   ?? mission.charged_km ?? 0
  } else if (mission.distance_km != null) {
    kmCharged    = mission.distance_km
    kmTotalRoute = mission.distance_km
  } else if (mission.id) {
    const km = await computeMissionKm(mission.id)
    kmCharged    = km.chargedKm ?? 0
    kmTotalRoute = km.totalKm   ?? 0
  }
  const kmBase = kmBasis === 'total' ? kmTotalRoute : kmCharged
  const kmRounded = Math.ceil(kmBase)  // arrondit superieur pour la tranche

  // 2. Charge la grille de brackets en vigueur
  const today = new Date().toISOString().slice(0, 10)
  const { data: brackets } = await sb
    .from('source_tariff_brackets')
    .select('from_km, to_km, price_normal, price_majore, effective_from')
    .eq('source', source)
    .eq('mission_type', missionType)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order('from_km', { ascending: true })

  if (!brackets || brackets.length === 0) {
    return emptyEstimate(source, missionType, `Aucune tranche tarifaire trouvée pour ${source} (mode brackets)`)
  }

  // 3. Determine si l heure est majoree (regle IPA hardcodee pour l instant)
  const interventionDateStr = mission.intervention_date || mission.received_at
  const interventionDate = interventionDateStr ? new Date(interventionDateStr) : new Date()
  const majoree = isIpaMajoredHour(interventionDate)

  // 4. Trouve le bracket couvrant kmRounded
  let matchingBracket = brackets.find(b => kmRounded >= b.from_km && kmRounded <= b.to_km)
  let extraSteps = 0
  let extraPrice = 0
  if (!matchingBracket) {
    // Au-dela du max : prix du dernier bracket + step au-dela
    const lastBracket = brackets[brackets.length - 1]
    if (kmRounded > lastBracket.to_km && tariff.beyond_max_km && tariff.beyond_max_step_km && tariff.beyond_max_step_price) {
      matchingBracket = lastBracket
      const overshoot = kmRounded - Number(tariff.beyond_max_km)
      extraSteps = Math.ceil(overshoot / Number(tariff.beyond_max_step_km))
      extraPrice = extraSteps * Number(tariff.beyond_max_step_price)
    } else {
      // Cas en dessous du min (rare car bracket commence a 0)
      matchingBracket = brackets[0]
    }
  }

  const bracketPrice = majoree
    ? Number(matchingBracket.price_majore)
    : Number(matchingBracket.price_normal)
  const tariffTotal = bracketPrice + extraPrice

  // 5. Parc si parked_at + parc_day_price (geree comme avant)
  let parcJours = 0
  let parcEur = 0
  // Olivier 2026-06-02 PM : gardiennage UNIQUEMENT si passage en parc
  // (parked_at non null). Date de fin = sortie effective (delivering_at)
  // > cloture (completed_at) > aujourd hui (encore en parc).
  // Math.floor : jour d arrivee non compte (jours pleins ecoules).
  if (mission.parked_at && tariff.parc_day_price) {
    const parcStart = new Date(mission.parked_at)
    const refEnd    = (mission as any).delivering_at
                   || (mission as any).completed_at
                   || new Date().toISOString()
    const parcEnd   = new Date(refEnd)
    const diffMs    = Math.max(0, parcEnd.getTime() - parcStart.getTime())
    parcJours       = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    parcEur         = parcJours * Number(tariff.parc_day_price || 0)
  }

  const total = tariffTotal + parcEur

  const tariffLabel = extraSteps > 0
    ? `Tarif IPA ${kmBase} km (tranche ${matchingBracket.from_km}-${matchingBracket.to_km} ${majoree ? 'majoré' : 'normal'} + ${extraSteps} × ${Number(tariff.beyond_max_step_price).toFixed(2).replace('.', ',')} € au-delà de ${tariff.beyond_max_km} km)`
    : `Tarif IPA ${kmBase} km — tranche ${matchingBracket.from_km}-${matchingBracket.to_km} (${majoree ? 'heure majorée' : 'heure normale'})`

  const breakdown = [
    { label: tariffLabel, amount: tariffTotal },
    { label: 'Parc', amount: parcEur > 0 ? parcEur : null, note: parcJours > 0 ? `${parcJours} jour(s) × ${Number(tariff.parc_day_price || 0).toFixed(2)} €` : 'non applicable' },
  ]

  return {
    ok:            true,
    source,
    mission_type:  missionType,
    pricing_mode:  'brackets',
    forfait:       tariffTotal,        // On expose le total IPA comme "forfait" pour compat UI/devis
    km_charged:    kmBase,
    km_inclus:     0,                  // Pas applicable en mode brackets
    km_extra:      0,
    km_extra_eur:  0,
    parc_jours:    parcJours,
    parc_eur:      parcEur,
    subtotal_eur:  total,
    surcharge_pct: 0,                  // Majoration deja integree
    surcharge_eur: 0,
    total_eur:     total,
    is_autofac:    Boolean(tariff.is_autofac),
    tariff_id:     tariff.id,
    tariff_doc_path: tariff.source_document_path,
    tariff_doc_name: tariff.source_document_name,
    breakdown,
  }
}

/**
 * Branche "lines" : retourne les lignes pre-configurees du template (source +
 * mission_type) + calcule la majoration applicable via getApplicableSurcharges.
 * L employe ajuste les qty/PU cote UI avant le push Odoo.
 */
async function estimateLinesTemplate(
  mission:     MissionLike,
  source:      string,
  missionType: string,
  tariff:      any,
  sb:          ReturnType<typeof createAdminClient>,
): Promise<PriceEstimate> {
  const today = new Date().toISOString().slice(0, 10)
  const vehicleClass = (mission.vehicle_class || 'car').toLowerCase()

  // Lignes filtrees par vehicle_class : on prend les lignes specifiques
  // au vehicle_class de la mission, OU les lignes generiques (vehicle_class IS NULL).
  // Une ligne specifique prime sur une ligne generique (meme kind+position).
  //
  // Note 2026-05-25 : on filtre vehicle_class et effective_to en JS apres
  // requete car chainer deux .or() dans Supabase JS v2 genere ?or=(...)&or=(...)
  // mal interprete par PostgREST. Symptome : la requete renvoie 0 ligne alors
  // que les 6 lignes police_accident existent bien (cf bug Olivier 2026-05-25).
  const { data: linesRaw, error: linesErr } = await sb
    .from('source_tariff_lines')
    .select('id, position, kind, name, default_qty, default_price, default_price_majore, apply_surcharges, vehicle_class, effective_to, free_days, parc_count_from')
    .eq('source', source)
    .eq('mission_type', missionType)
    .lte('effective_from', today)
    .order('vehicle_class', { ascending: false, nullsFirst: false })
    .order('position', { ascending: true })

  if (linesErr) {
    console.error('[estimate-price] source_tariff_lines query error:', linesErr.message, { source, missionType, today })
  }

  const lines = (linesRaw || []).filter(l => {
    const vehicleOk     = !l.vehicle_class || l.vehicle_class === vehicleClass
    const effectiveToOk = !l.effective_to  || l.effective_to >= today
    return vehicleOk && effectiveToOk
  })

  // Auto-calcul de qty pour les lignes specifiques quand default_qty=null :
  //   - SERV-PARC : nombre de jours depuis mission.parked_at
  //   - SERV-KM   : max(0, autoKm - tariff.km_inclus) (km hors forfait)
  //
  // Fallback parked_at -> received_at (Olivier 2026-05-25) : certaines missions
  // legacy parked n ont pas parked_at en BDD (set seulement depuis les
  // transitions recentes). Pour eviter "Frais de gardiennage : qty/PU a saisir",
  // on prend received_at comme proxy (date de reception ~= date d entree parc
  // pour les missions Police fourriere). Le fallback ne tire que sur des
  // grilles qui ont effectivement une ligne SERV-PARC (= sources fourriere).
  // Olivier 2026-05-28 : on ne compte JAMAIS le jour d arrivee dans le
  // gardiennage. -> Math.floor (seuls les jours pleins ecoules sont factures).
  // La reference de debut est parked_at par defaut, mais peut etre
  // intervention_date selon la ligne SERV-PARC (cas Mal Garee).
  // Le calcul global ci-dessous reste base sur parked_at (utilise par les
  // sources sans parc_count_from ou avec 'parked_at'). Les lignes avec
  // parc_count_from='intervention_date' recalculent autoQty plus bas.
  function joursPleinsEcoules(ref: string | null | undefined): number {
    if (!ref) return 0
    const start = new Date(ref).getTime()
    const diffMs = Math.max(0, Date.now() - start)
    return Math.floor(diffMs / (1000 * 60 * 60 * 24))
  }
  // Jours pleins entre deux dates (end = now si non fourni). Sert au split
  // gardiennage Saisie (parked_at -> date de levée).
  function joursPleinsBetween(startRef: string | null | undefined, endRef: string | null | undefined): number {
    if (!startRef) return 0
    const start = new Date(startRef).getTime()
    const end   = endRef ? new Date(endRef).getTime() : Date.now()
    const diffMs = Math.max(0, end - start)
    return Math.floor(diffMs / (1000 * 60 * 60 * 24))
  }
  const autoParcJoursParked       = joursPleinsEcoules(mission.parked_at || mission.received_at)
  const autoParcJoursIntervention = joursPleinsEcoules(mission.intervention_date || mission.received_at)
  let autoKm = 0
  if (mission.total_km != null || mission.charged_km != null) {
    // Preview cote dispatch : on choisit la bonne valeur selon tariff.km_basis.
    autoKm = tariff.km_basis === 'total'
      ? (mission.total_km   ?? mission.charged_km ?? 0)
      : (mission.charged_km ?? mission.total_km   ?? 0)
  } else if (mission.distance_km != null) {
    autoKm = mission.distance_km
  } else if (mission.id) {
    try {
      const km = await computeMissionKm(mission.id)
      autoKm = (tariff.km_basis === 'total' ? km.totalKm : km.chargedKm) ?? 0
    } catch {}
  }
  const kmInclus = Number(tariff.km_inclus || 0)
  const kmHorsForfait = Math.max(0, autoKm - kmInclus)

  // 1. Determination si la majoration horaire est applicable (plages
  //    source-specifiques via /admin/surcharges)
  let surchargePct = 0
  let surchargeNote = ''
  let surchargeApplies = false
  const interventionDateStr = mission.intervention_date || mission.received_at
  if (interventionDateStr) {
    try {
      const applicable = await getApplicableSurcharges({
        source:            mission.source,
        client_name:       mission.client_name,
        mission_type:      mission.mission_type,
        incident_type:     mission.incident_type || null,
        parent_mission_id: mission.parent_mission_id || null,
      }, new Date(interventionDateStr))
      if (applicable.length > 0) {
        surchargeApplies = true
        surchargePct = applicable.reduce((s, x) => s + Number(x.rate_pct || 0), 0)
        surchargeNote = applicable.map(x => Number(x.rate_pct) > 0
          ? `${x.weekday_label} ${x.range_label} +${x.rate_pct}%`
          : `${x.weekday_label} ${x.range_label} (tarif majoré)`).join(', ')
      }
    } catch {}
  }
  // isMajored = un % > 0 OU une ligne a un prix majoré distinct (default_price_majore)
  // pendant qu'une période de majoration matche. Ainsi les deux mécanismes
  // marchent : majoration en % (subtotalMajorable × pct) OU bascule sur le prix
  // majoré stocké (cas Saisie/Accident où le prix majoré est figé en grille).
  const hasMajoredPriceLine = (lines || []).some(l => l.default_price_majore != null)
  const isMajored = surchargePct > 0 || (surchargeApplies && hasMajoredPriceLine)

  // 2. Deduplication par position : garde la ligne specifique au vehicle_class
  //    si dispo, sinon la generique. (L ORDER BY vehicle_class DESC nullsFirst=false
  //    a deja place les specifiques avant les generiques.)
  const seenPositions = new Set<number>()
  const dedupedLines = (lines || []).filter(l => {
    if (seenPositions.has(l.position)) return false
    seenPositions.add(l.position)
    return true
  })

  const nowIso = new Date().toISOString()
  const templateLines: TemplateLine[] = dedupedLines.map(l => {
    const qtyConfigured = l.default_qty != null ? Number(l.default_qty) : null
    let autoQty: number | null = qtyConfigured
    // SERV-PARC : période (début → fin) qui compose le décompte de jours.
    let parcFrom: string | null = null
    let parcTo:   string | null = null
    if (qtyConfigured == null) {
      if (l.kind === 'SERV-PARC') {
        // Olivier 2026-05-28 :
        // - Reference de depart selon parc_count_from (parked_at par defaut,
        //   intervention_date pour Mal Garee).
        // - free_days = jours offerts (ex: SC = 3).
        // - Jour d arrivee jamais compte (Math.floor : seuls jours pleins).
        // -> qty facturable = max(0, jours_pleins_ecoules - free_days).
        //
        // Olivier 2026-06-13 (Saisie, gardiennage 2 tarifs) :
        // - Ligne 'levee_saisie_date' = gardiennage HORS période saisie : jours
        //   APRES la levée. Depart = retour en parc (levée temporaire) sinon la
        //   date de levée. 0 tant qu il n y a pas de levée.
        // - Ligne standard : si une date de levée existe, on BORNE le decompte
        //   au jour de levée (les jours au-dela sont sur la ligne hors période).
        const freeDays  = Number(l.free_days || 0)
        // Le split gardiennage (levée → hors période / remise Domaine) est
        // SPÉCIFIQUE à la Saisie. Pour Rodéo/Mal Garée, la levée sert seulement
        // à débloquer la restitution et ne doit pas borner le gardiennage.
        const leveeDate   = source === 'police_saisie' ? mission.levee_saisie_date   : null
        const domaineDate = source === 'police_saisie' ? mission.domaine_remise_date : null
        // Coupure de la période facturable au client/parquet :
        //   - remise au Domaine prime (l'État reprend après) ;
        //   - sinon la date de levée (au-delà = ligne "hors période" 20 €/j).
        const cutoff = domaineDate || leveeDate
        if (l.parc_count_from === 'levee_saisie_date') {
          // Gardiennage hors période saisie (20 €/j) : uniquement en cas de
          // levée (propriétaire récupère). Pas applicable si remise au Domaine.
          const startRef = mission.temp_returned_at || leveeDate
          autoQty = (startRef && !domaineDate) ? Math.max(0, joursPleinsEcoules(startRef) - freeDays) : 0
          parcFrom = startRef || null
          parcTo   = (startRef && !domaineDate) ? nowIso : null
        } else if (cutoff) {
          const startRef = l.parc_count_from === 'intervention_date'
            ? (mission.intervention_date || mission.received_at)
            : (mission.parked_at || mission.received_at)
          autoQty = Math.max(0, joursPleinsBetween(startRef, cutoff) - freeDays)
          parcFrom = startRef || null
          parcTo   = cutoff
        } else {
          const ref = l.parc_count_from === 'intervention_date'
            ? autoParcJoursIntervention
            : autoParcJoursParked
          autoQty = Math.max(0, ref - freeDays)
          parcFrom = l.parc_count_from === 'intervention_date'
            ? (mission.intervention_date || mission.received_at || null)
            : (mission.parked_at || mission.received_at || null)
          parcTo   = nowIso
        }
      }
      if (l.kind === 'SERV-KM'   && kmHorsForfait > 0) autoQty = Math.ceil(kmHorsForfait)
    }
    // Choix du prix : si majoration applicable ET la ligne a un prix majore
    // distinct, on prend ce prix. Sinon prix normal.
    const priceNormal  = l.default_price != null ? Number(l.default_price) : null
    const priceMajore  = l.default_price_majore != null ? Number(l.default_price_majore) : null
    const priceToUse   = (isMajored && priceMajore != null) ? priceMajore : priceNormal
    return {
      kind:             l.kind as TemplateLine['kind'],
      name:             l.name,
      default_qty:      autoQty,
      default_price:    priceToUse,
      apply_surcharges: !!l.apply_surcharges && priceMajore == null,
      parc_from:        parcFrom,
      parc_to:          parcTo,
      // ^ Si la ligne a son propre prix majore, elle n'est PLUS soumise a la
      //   majoration calculee +X% (sinon double comptage). Pour les autres
      //   lignes (Accident PCD/TD/MOE) sans prix majore distinct : ancien
      //   comportement (apply_surcharges=true -> contribue au subtotal
      //   majorable -> ligne SERV-MAJ ajoutee).
    }
  })

  if (templateLines.length === 0) {
    return emptyEstimate(source, missionType,
      `Aucune ligne configuree pour ${source}/${missionType} en mode "lines". Ajoute des lignes dans /admin/tarifs.`)
  }

  // Calcule un subtotal indicatif (sur les defauts existants) pour estimation
  let subtotalIndicatif = 0
  let subtotalMajorable = 0
  for (const l of templateLines) {
    if (l.default_qty != null && l.default_price != null) {
      const t = l.default_qty * l.default_price
      subtotalIndicatif += t
      if (l.apply_surcharges) subtotalMajorable += t
    }
  }

  // La majoration horaire applicable a deja ete calculee au debut
  // (surchargePct + surchargeNote sont disponibles). Pour les lignes qui ont
  // un default_price_majore distinct, on a deja substitue le prix dans le
  // subtotal — pas de SERV-MAJ calculee a ajouter. Pour les lignes legacy
  // (apply_surcharges=true SANS default_price_majore), on ajoute la
  // surcharge sur le subtotal majorable.
  const surchargeEur = (subtotalMajorable * surchargePct) / 100
  const total = subtotalIndicatif + surchargeEur

  const breakdown = [
    ...templateLines.map(l => {
      const hasQty   = l.default_qty   != null && l.default_qty > 0
      const hasPrice = l.default_price != null
      const unit     = l.kind === 'SERV-PARC' ? 'jour' : l.kind === 'SERV-KM' ? 'km' : 'u'
      // Note plus parlante quand on a le PU mais pas la qty : affiche
      // "20.00 EUR/jour" plutot que "qty/PU a saisir" (Olivier 2026-05-25 :
      // "les jours de gardiennage toujours pas visible dans l estimation").
      let note: string | undefined
      if (!hasQty && hasPrice) {
        note = `${Number(l.default_price).toFixed(2)} €/${unit}`
      } else if (!hasQty || !hasPrice) {
        note = 'qty/PU à saisir'
      }
      // SERV-PARC : ajoute la période (début → fin) qui compose le décompte de jours.
      if (l.kind === 'SERV-PARC' && l.parc_from) {
        const fmtJ = (iso: string) => {
          try { return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
          catch { return iso.slice(0, 10) }
        }
        const periode = l.parc_to
          ? `du ${fmtJ(l.parc_from)} au ${fmtJ(l.parc_to)}`
          : `à partir du ${fmtJ(l.parc_from)}`
        note = note ? `${note} · ${periode}` : periode
      }
      return {
        label: `${l.kind} — ${l.name}`,
        amount: (hasQty && hasPrice) ? Number(l.default_qty) * Number(l.default_price) : null,
        note,
      }
    }),
    { label: 'Majoration horaire', amount: surchargeEur > 0 ? surchargeEur : null, note: surchargeNote || 'aucune' },
  ]

  return {
    ok:               true,
    source,
    mission_type:     missionType,
    pricing_mode:     'lines',
    forfait:          null,
    km_charged:       0,
    km_inclus:        0,
    km_extra:         0,
    km_extra_eur:     0,
    parc_jours:       0,
    parc_eur:         0,
    subtotal_eur:     subtotalIndicatif,
    surcharge_pct:    surchargePct,
    surcharge_eur:    surchargeEur,
    total_eur:        total,
    is_autofac:       Boolean(tariff.is_autofac),
    tariff_id:        tariff.id,
    tariff_doc_path:  tariff.source_document_path,
    tariff_doc_name:  tariff.source_document_name,
    breakdown,
    template_lines:   templateLines,
  }
}

/**
 * Tarification REL (relivraison) : on facture uniquement les kilometres
 * parcourus (parc -> client) au tarif km de la source. Pas de prise en
 * charge, pas de treuil, pas de km inclus, pas de gardiennage.
 *
 * Olivier 2026-05-28 : "Par defaut on refacture les kilometres au tarif
 * kilometrique sans aucun km inclu et sans prise en charge ni Treuil, etc...
 * On ne reprend que les kilometres."
 *
 * Source du prix au km (par ordre de priorite) :
 *   1. source_tariff_lines avec kind='SERV-KM' pour cette source (default_price
 *      ou default_price_majore selon plage horaire)
 *   2. source_tariffs.km_extra_price (mode forfait/brackets)
 */
async function estimateRelivraisonPrice(
  mission: MissionLike,
  source:  string,
): Promise<PriceEstimate> {
  const sb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // ── Règles de tarif REL par source (Olivier 2026-06-18) ──────────────────
  //   • AXA, Ardenne, Allianz(mondial) → la relivraison se facture au tarif
  //     REMORQUAGE (forfait + km supplémentaires), pas au km pur.
  //   • Touring → km total × prix km (comportement par défaut ci-dessous),
  //     SAUF si la mission d'origine (parent) est un appel police ou Siabis
  //     non couvert → alors tarif REMORQUAGE de cette source d'origine.
  //   • Autres sources → km pur (inchangé).
  let parentSource = source
  let parentSnc: string | null = null
  if (mission.parent_mission_id) {
    const { data: parent } = await sb
      .from('incoming_missions')
      .select('source, snc_scenario')
      .eq('id', mission.parent_mission_id)
      .maybeSingle()
    if (parent?.source) parentSource = String(parent.source).toLowerCase().trim()
    parentSnc = (parent as any)?.snc_scenario || null
  }
  const parentIsPoliceOuSnc = parentSource.startsWith('police')
    || ['sia_couvert', 'police_snc'].includes(parentSource)
    || !!parentSnc
  const REL_AU_TARIF_REM = new Set(['axa', 'ardenne', 'mondial'])

  if (REL_AU_TARIF_REM.has(source) || parentIsPoliceOuSnc) {
    // Source dont la REL se facture au tarif remorquage. Pour AXA/Ardenne/Allianz
    // on garde leur propre source ; pour le cas police/SNC on prend la source
    // d'origine (police_…) qui porte la grille remorquage applicable.
    const remSource = REL_AU_TARIF_REM.has(source) ? source : parentSource
    const remEstimate = await estimateMissionPrice({ ...mission, source: remSource, mission_type: 'remorquage' })
    if (remEstimate.ok) {
      return {
        ...remEstimate,
        mission_type: 'relivraison',
        tariff_id:    `${remSource}-relivraison-tarif-remorquage`,
        breakdown: [
          ...remEstimate.breakdown,
          { label: 'Relivraison', amount: null, note: `Facturée au tarif remorquage (${remSource})` },
        ],
      }
    }
    // Si pas de grille remorquage trouvée, on retombe sur le calcul km ci-dessous.
  }

  // 1. Lookup prix km via source_tariff_lines (kind=SERV-KM)
  const { data: kmLinesRaw } = await sb
    .from('source_tariff_lines')
    .select('name, default_price, default_price_majore, effective_to')
    .eq('source', source)
    .eq('kind', 'SERV-KM')
    .lte('effective_from', today)
  const kmLine = (kmLinesRaw || []).find(l => !l.effective_to || l.effective_to >= today)

  // 2. Fallback : source_tariffs.km_extra_price (mode forfait)
  let kmPriceNormal: number | null = null
  let kmPriceMajored: number | null = null
  let priceLabel = 'Kilomètres relivraison'
  if (kmLine && kmLine.default_price != null) {
    kmPriceNormal  = Number(kmLine.default_price)
    kmPriceMajored = kmLine.default_price_majore != null ? Number(kmLine.default_price_majore) : null
    priceLabel = kmLine.name || priceLabel
  } else {
    const { data: tariffsRaw } = await sb
      .from('source_tariffs')
      .select('km_extra_price, effective_to')
      .eq('source', source)
      .eq('mission_type', 'remorquage')
      .lte('effective_from', today)
      .order('effective_from', { ascending: false })
    const t = (tariffsRaw || []).find(t => !t.effective_to || t.effective_to >= today)
    if (t && t.km_extra_price != null) {
      kmPriceNormal = Number(t.km_extra_price)
    }
  }

  if (kmPriceNormal == null || kmPriceNormal <= 0) {
    return emptyEstimate(source, 'relivraison',
      `Aucun tarif kilometrique configure pour la source ${source}. Ajoute une ligne SERV-KM dans /admin/tarifs pour cette source.`)
  }

  // 3. Determine le prix km a appliquer selon majoration horaire eventuelle
  let surchargePct = 0
  let surchargeNote = ''
  const interventionDateStr = mission.intervention_date || mission.received_at
  if (interventionDateStr) {
    try {
      const applicable = await getApplicableSurcharges({
        source:            mission.source,
        client_name:       mission.client_name,
        mission_type:      mission.mission_type,
        incident_type:     mission.incident_type || null,
        parent_mission_id: mission.parent_mission_id || null,
      }, new Date(interventionDateStr))
      if (applicable.length > 0) {
        surchargePct = applicable.reduce((s, x) => s + Number(x.rate_pct || 0), 0)
        surchargeNote = applicable.map(x => `${x.weekday_label} ${x.range_label} +${x.rate_pct}%`).join(', ')
      }
    } catch {}
  }
  const isMajored = surchargePct > 0
  const kmPrice = (isMajored && kmPriceMajored != null) ? kmPriceMajored : kmPriceNormal

  // 4. Recupere les kilometres
  let km = 0
  if (mission.charged_km != null) {
    km = Number(mission.charged_km)
  } else if (mission.total_km != null) {
    km = Number(mission.total_km)
  } else if (mission.distance_km != null) {
    km = Number(mission.distance_km)
  } else if (mission.id) {
    try {
      const computed = await computeMissionKm(mission.id)
      km = computed.chargedKm ?? computed.totalKm ?? 0
    } catch {}
  }
  km = Math.max(0, Math.ceil(km))

  const total = Math.round(km * kmPrice * 100) / 100

  // 5. Si la ligne SERV-KM avait un prix majore distinct, la majoration est
  // deja incluse dans le prix unitaire (pas de SERV-MAJ a ajouter). Sinon on
  // applique la majoration sur le subtotal.
  const hasOwnMajorPrice = kmLine && kmLine.default_price_majore != null
  const surchargeEur = !hasOwnMajorPrice && isMajored
    ? Math.round(total * surchargePct) / 100
    : 0
  const finalTotal = total + surchargeEur

  return {
    ok:            true,
    source,
    mission_type:  'relivraison',
    pricing_mode:  'forfait',
    forfait:       total,
    km_charged:    km,
    km_inclus:     0,
    km_extra:      km,
    km_extra_eur:  total,
    parc_jours:    0,
    parc_eur:      0,
    subtotal_eur:  total,
    surcharge_pct: hasOwnMajorPrice ? 0 : surchargePct,
    surcharge_eur: surchargeEur,
    total_eur:     finalTotal,
    is_autofac:    false,
    tariff_id:     `${source}-relivraison-km`,
    tariff_doc_path: null,
    tariff_doc_name: null,
    breakdown: [
      { label: priceLabel, amount: total, note: `${km} km × ${kmPrice.toFixed(4)} €${isMajored && hasOwnMajorPrice ? ' (tarif majoré)' : ''}` },
      ...(surchargeEur > 0 ? [{ label: `Majoration horaire (+${surchargePct}%)`, amount: surchargeEur, note: surchargeNote }] : []),
    ],
  }
}

function emptyEstimate(source: string, missionType: string, reason: string): PriceEstimate {
  return {
    ok:            false,
    reason,
    source,
    mission_type:  missionType,
    pricing_mode:  'forfait',
    forfait:       null,
    km_charged:    0,
    km_inclus:     0,
    km_extra:      0,
    km_extra_eur:  0,
    parc_jours:    0,
    parc_eur:      0,
    subtotal_eur:  0,
    surcharge_pct: 0,
    surcharge_eur: 0,
    total_eur:     0,
    is_autofac:    false,
    tariff_id:     '',
    tariff_doc_path: null,
    tariff_doc_name: null,
    breakdown:     [],
  }
}
