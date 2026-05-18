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
import { normalizeType, isRemorquage, isDsp, isTrajetVide } from '@/lib/missions/mission-types'

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

export interface PriceEstimate {
  ok:            boolean
  reason?:       string  // si pas de tarif trouve
  source:        string  // source utilisee pour le lookup
  mission_type:  string  // type canonical
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
  is_autofac:    boolean // si autofacturation (info pour dispatcher)
  tariff_id:     string  // id du source_tariff utilise
  tariff_doc_path: string | null
  tariff_doc_name: string | null
  breakdown:     { label: string; amount: number | null; note?: string }[]
}

interface MissionLike {
  id?:                string
  source:             string | null
  mission_type:       string | null
  client_name:        string | null
  vehicle_mileage:    number | null
  parked_at?:         string | null
  intervention_date?: string | null
  received_at?:       string | null
  incident_type?:     string | null
  parent_mission_id?: string | null
}

/** Map mission_type DB vers le canonical attendu en source_tariffs (lowercase). */
function canonicalType(t: string | null): string | null {
  if (isRemorquage(t)) return 'remorquage'
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

  const sb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // 1. Lookup le tarif en vigueur (effective_from <= today, effective_to >= today ou null).
  //    Si plusieurs lignes, prend la plus recente (effective_from DESC).
  const { data: tariffs } = await sb
    .from('source_tariffs')
    .select('*')
    .eq('source', source)
    .eq('mission_type', missionType)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order('effective_from', { ascending: false })
    .limit(1)

  const tariff = tariffs?.[0]
  if (!tariff) {
    return emptyEstimate(source, missionType, `Aucun tarif ${source}/${missionType} en vigueur`)
  }

  // 2. Calcul forfait + km extra
  //    Le tarif spec quelle base de km utiliser (km_basis) :
  //      - 'charged' (default) : incident → destination (assurances)
  //      - 'total'             : depot → incident → ... → retour depot (priv/garage)
  const forfait = Number(tariff.unit_price || 0)
  const kmBasis: 'charged' | 'total' = tariff.km_basis === 'total' ? 'total' : 'charged'
  let kmCharged = 0
  let kmTotalRoute = 0
  if (mission.id) {
    const km = await computeMissionKm(mission.id)
    kmCharged    = km.chargedKm ?? 0
    kmTotalRoute = km.totalKm   ?? 0
  }
  const kmBase = kmBasis === 'total' ? kmTotalRoute : kmCharged
  const kmInclus = Number(tariff.km_inclus || 0)
  const kmExtra = Math.max(0, kmBase - kmInclus)
  const kmExtraEur = kmExtra * Number(tariff.km_price || 0)

  // 3. Calcul parc si parked_at est set
  let parcJours = 0
  let parcEur = 0
  if (mission.parked_at && tariff.parc_day_price) {
    const parcStart = new Date(mission.parked_at)
    const parcEnd = new Date()
    const diffMs = Math.max(0, parcEnd.getTime() - parcStart.getTime())
    parcJours = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    parcEur = parcJours * Number(tariff.parc_day_price || 0)
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

function emptyEstimate(source: string, missionType: string, reason: string): PriceEstimate {
  return {
    ok:            false,
    reason,
    source,
    mission_type:  missionType,
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
