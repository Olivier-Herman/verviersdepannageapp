// src/lib/snc/pricing.ts
//
// Tarification SNC (Siabis Non Couvert) : intervention sur autoroute.
//
// Lignes generees selon scenario + balisage + majoration horaire :
//   - SIAREM      : prise en charge SNC (161.98 HTVA normal / 242.98 majore = PECSIAMAJ)
//   - SIAKIL      : kilometre depanneuse (1.0744 normal / 1.65 majore = SIAKILMAJ)
//   - SIABAL      : supplement balisage (150 normal / 175.21 majore = SIABALMAJ)
//
// Logique km selon scenario :
//   - dsp        : km depanneuse = depot -> intervention -> depot (aller-retour)
//   - rem_client : km depanneuse = depot -> intervention -> destination -> depot (SNC)
//   - rem_direct : SC uniquement. Olivier 2026-06-02 PM v3 (formule finale) :
//                    - km_depanneuse  = depot -> intervention -> depot
//                                       INTEGRALEMENT couvert par le forfait SC.
//                                       Calcule pour affichage uniquement.
//                    - km_livraison   = depot -> destination -> depot
//                                       SEUL segment facture. Tarif km =
//                                       celui de l ASSISTANCE (billed_to) via
//                                       source_tariffs, moins km inclus du
//                                       forfait remorquage assistance (Touring 20, etc.).
//   - rem_depot  : km depanneuse = depot -> intervention -> depot (Pepinster force)
//   - balisage   : toujours depot -> intervention -> depot (rentre seul apres)
//
// Bascule MAJ : si l intervention tombe dans une plage horaire definie dans
// /admin/surcharges (client_key = 'snc' avec rate > 0 ou meme 0 = plage active),
// on bascule sur les codes MAJ.

import { createAdminClient } from '@/lib/supabase'

export interface SncDepot {
  id:       number | string
  name:     string
  lat:      number
  lng:      number
}

export interface SncDepotKey {
  /** name lower-cased, espaces -> _ (ex: 'pepinster', 'aywaille', 'verviers') */
  key: string
}

export interface SncCalcInput {
  scenario:           'dsp' | 'rem_client' | 'rem_depot' | 'rem_direct'
  requiresBalisage:   boolean
  interventionLat:    number | null
  interventionLng:    number | null
  destinationLat?:    number | null
  destinationLng?:    number | null
  interventionAt:     Date | string | null
  /** 'snc' (defaut) = avec km. 'sc' = Siabis Couvert, forfait sans km. */
  variant?:           'snc' | 'sc'
  /** Pour SC + rem_direct uniquement : identifie l assistance facturee
   *  (id Odoo prioritaire, name en fallback). On remonte ensuite a la source
   *  via mission_source_catalog.default_billed_to_id, puis on lit
   *  source_tariffs(source, 'remorquage') pour avoir km_price + km_inclus. */
  billedToId?:        number | null
  billedToName?:      string | null
  /** Olivier 2026-06-02 PM : stops intermediaires ajoutes par le chauffeur
   *  (extra_addresses). Inseres SEQUENTIELLEMENT dans le trajet avant la
   *  destination finale. Ignore les stops sans lat/lng. */
  stops?:             Array<{ lat: number | null; lng: number | null; label?: string }>
}

export interface SncCalcOutput {
  depart_depot:           string    // nom du depot depanneuse (le plus proche parmi tous)
  depart_depot_id:        number | string
  balisage_depot?:        string    // nom du depot balisage (Pepinster ou Aywaille, le plus proche)
  balisage_depot_id?:     number | string
  km_depanneuse:          number    // total km depanneuse (depot -> ... -> depot)
  /** SC + rem_direct : double segment (depot->intervention->depot) +
   *  (depot->destination->depot). 0 sinon. */
  km_livraison?:          number
  /** SC + rem_direct : tarif km de l assistance (depuis source_tariffs).
   *  null si pas trouve → buildSncQuoteLines fallback sur le tarif SIAKIL. */
  livraison_km_price?:    number | null
  /** SC + rem_direct : km inclus dans le forfait remorquage de l assistance
   *  (Touring 20, VAB 40, etc.). 0 si pas trouve. */
  livraison_km_inclus?:   number
  /** SC + rem_direct : nom de l assistance utilise pour le calcul (si match). */
  livraison_assistance?:  string | null
  km_balisage:            number    // km balisage (aller-retour intervention depuis SON depot)
  is_majored:             boolean
  note:                   string    // explication calcul (visible facturation)
  /** Olivier 2026-06-02 PM : detail visuel des segments km pour controle.
   *  Affiche dans la breakdown PriceEstimateCard. */
  km_segments?:           Array<{ label: string; km: number }>
}

const GMAPS_KEY = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/** Distance haversine en km entre 2 points GPS. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * SC + rem_direct (Olivier 2026-06-02 PM) : remonte du billed_to (assistance
 * facturee) au tarif km / km_inclus correspondant.
 *
 * Chaine de recherche :
 *   1. mission_source_catalog WHERE default_billed_to_id = billedToId
 *      → recupere la source-key (ex: 'touring', 'vab')
 *   2. fallback : mission_source_catalog WHERE default_billed_to_name ILIKE billedToName
 *   3. source_tariffs WHERE source = key AND mission_type = 'remorquage'
 *      ORDER BY effective_from DESC LIMIT 1
 *      → recupere km_price + km_inclus
 *
 * Retourne null si rien trouve → buildSncQuoteLines fallback sur SIAKIL standard.
 */
export async function findAssistanceTariff(input: {
  billedToId?:   number | null
  billedToName?: string | null
}): Promise<{ source_key: string; assistance_name: string; km_price: number; km_inclus: number } | null> {
  if (!input.billedToId && !input.billedToName) return null
  const sb = createAdminClient()

  // 1. Recherche source par billed_to_id (prioritaire)
  let sourceKey: string | null   = null
  let assistanceName: string     = input.billedToName || ''
  if (input.billedToId) {
    const { data: sc } = await sb
      .from('mission_source_catalog')
      .select('key, default_billed_to_name')
      .eq('default_billed_to_id', input.billedToId)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (sc?.key) {
      sourceKey      = sc.key
      assistanceName = sc.default_billed_to_name || assistanceName
    }
  }
  // 2. Fallback : recherche par nom (ILIKE pour tolerer la casse / espaces)
  if (!sourceKey && input.billedToName) {
    const { data: sc } = await sb
      .from('mission_source_catalog')
      .select('key, default_billed_to_name')
      .ilike('default_billed_to_name', input.billedToName.trim())
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (sc?.key) {
      sourceKey      = sc.key
      assistanceName = sc.default_billed_to_name || input.billedToName
    }
  }
  if (!sourceKey) return null

  // 3. Tarif remorquage de cette source
  const { data: tariff } = await sb
    .from('source_tariffs')
    .select('km_price, km_inclus')
    .eq('source', sourceKey)
    .eq('mission_type', 'remorquage')
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!tariff) return null

  return {
    source_key:      sourceKey,
    assistance_name: assistanceName,
    km_price:        Number(tariff.km_price)  || 0,
    km_inclus:       Number(tariff.km_inclus) || 0,
  }
}

/** Charge TOUS les depots actifs SNC (avec lat/lng valides). */
export async function getSncDepots(): Promise<SncDepot[]> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('depots')
    .select('id, name, lat, lng')
    .eq('active', true)
    .not('lat', 'is', null)
    .not('lng', 'is', null)
  return (data || []) as SncDepot[]
}

/** Cherche le depot le plus proche du lieu d intervention (haversine).
 *  Olivier 2026-06-02 PM : prefer findNearestDepotByRoute (Google Distance
 *  Matrix) pour avoir le bon depot quand haversine donne un mauvais resultat
 *  (routes sinueuses, autoroutes en sens unique). Garde celui-ci en fallback. */
export function findNearestDepot(lat: number, lng: number, depots: SncDepot[]): SncDepot | null {
  if (depots.length === 0) return null
  let best: SncDepot | null = null
  let bestDist = Infinity
  for (const d of depots) {
    const dist = haversineKm(lat, lng, d.lat, d.lng)
    if (dist < bestDist) {
      bestDist = dist
      best = d
    }
  }
  return best
}

/**
 * Cherche le depot le plus proche du lieu d intervention via Google Distance
 * Matrix (distance ROUTE, pas vol d oiseau). Fait UN seul appel API avec tous
 * les depots en origins. Fallback haversine si Google echoue.
 *
 * Olivier 2026-06-02 PM : "Le dépôt en siabis doit être dynamique et calculé
 * au plus proche de l'intervention. Donc ici, A27 Jalhay, il n'aurait pas dû
 * indiquer Pepinster mais bien Tiège".
 */
export async function findNearestDepotByRoute(lat: number, lng: number, depots: SncDepot[]): Promise<SncDepot | null> {
  if (depots.length === 0) return null
  if (depots.length === 1) return depots[0]
  if (!GMAPS_KEY) return findNearestDepot(lat, lng, depots)
  try {
    const origins = depots.map(d => `${d.lat},${d.lng}`).join('|')
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json` +
                `?origins=${encodeURIComponent(origins)}` +
                `&destinations=${lat},${lng}` +
                `&mode=driving&units=metric&key=${GMAPS_KEY}`
    const res = await fetch(url)
    const j = await res.json()
    const rows = Array.isArray(j.rows) ? j.rows : []
    if (rows.length !== depots.length) return findNearestDepot(lat, lng, depots)
    let best: SncDepot | null = null
    let bestMeters = Infinity
    for (let i = 0; i < depots.length; i++) {
      const meters = rows[i]?.elements?.[0]?.distance?.value
      if (typeof meters === 'number' && meters < bestMeters) {
        bestMeters = meters
        best = depots[i]
      }
    }
    return best || findNearestDepot(lat, lng, depots)
  } catch {
    return findNearestDepot(lat, lng, depots)
  }
}

/** Cherche le depot Pepinster parmi la liste (case-insensitive sur name). */
export function findPepinster(depots: SncDepot[]): SncDepot | null {
  return depots.find(d => /pepinster/i.test(d.name)) || null
}

/** Cherche les depots BALISAGE : uniquement Pepinster et Aywaille (les autres
 *  depots n ont pas de vehicule de securite/balisage). */
export function findBalisageDepots(depots: SncDepot[]): SncDepot[] {
  return depots.filter(d => /pepinster|aywaille/i.test(d.name))
}

/** Calcule km route via Google Maps Distance Matrix. Fallback haversine si echec. */
async function calculateRouteKm(originLat: number, originLng: number, destLat: number, destLng: number): Promise<number> {
  if (!GMAPS_KEY) return Math.round(haversineKm(originLat, originLng, destLat, destLng) * 1.3) // approximation route
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${originLat},${originLng}` +
      `&destinations=${destLat},${destLng}` +
      `&mode=driving&units=metric&key=${GMAPS_KEY}`
    const res = await fetch(url)
    const j = await res.json()
    const meters = j.rows?.[0]?.elements?.[0]?.distance?.value
    if (typeof meters === 'number') return Math.round(meters / 1000)
    return Math.round(haversineKm(originLat, originLng, destLat, destLng) * 1.3)
  } catch {
    return Math.round(haversineKm(originLat, originLng, destLat, destLng) * 1.3)
  }
}

/** Verifie si une intervention tombe dans une plage de majoration SNC. */
export async function isSncMajored(at: Date | string | null): Promise<boolean> {
  if (!at) return false
  const d = at instanceof Date ? at : new Date(at)
  if (!isFinite(d.getTime())) return false

  const sb = createAdminClient()

  // Heure locale BE pour matcher les plages config locales
  const fmt = new Intl.DateTimeFormat('fr-BE', {
    timeZone: 'Europe/Brussels',
    weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const dayName  = parts.find(p => p.type === 'weekday')?.value || ''
  const dayMap: Record<string, number> = { 'lundi': 1, 'mardi': 2, 'mercredi': 3, 'jeudi': 4, 'vendredi': 5, 'samedi': 6, 'dimanche': 7 }
  const weekday = dayMap[dayName] || 0
  const hour   = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
  const decimalHour = hour + minute / 60

  // Cherche dans surcharge_schedules une plage active pour 'snc' (ou 'police_snc')
  const { data: schedules } = await sb
    .from('surcharge_schedules')
    .select('weekday, hour_start, hour_end, client_key')
    .in('client_key', ['snc', 'police_snc'])
    .eq('weekday', weekday)
  if (!schedules || schedules.length === 0) return false
  for (const s of schedules) {
    if (decimalHour >= s.hour_start && decimalHour < s.hour_end) return true
  }
  return false
}

/**
 * Calcule pour une mission SNC : depot de depart, km depanneuse, km balisage, majoration.
 * Retourne null si les coordonnees manquent.
 */
export async function computeSncMetrics(input: SncCalcInput): Promise<SncCalcOutput | null> {
  if (input.interventionLat == null || input.interventionLng == null) return null

  const depots = await getSncDepots()
  if (depots.length === 0) return null

  // Choix depot de depart pour la depanneuse : toujours le plus proche du lieu
  // d intervention parmi TOUS les depots actifs (regle Olivier).
  // Olivier 2026-06-02 PM : utilise Distance Matrix Google (route reelle)
  // au lieu de haversine. Sur A27 Jalhay, haversine pouvait donner Pepinster
  // alors que Tiege est plus proche par route. Fallback haversine si Google
  // echoue (pas de cle, quota, etc.).
  // Le depot retour = depot de depart pour la depanneuse, MEME en REM depot
  // (la depanneuse revient a son depot d origine apres avoir depose a Pepinster).
  const depart = await findNearestDepotByRoute(input.interventionLat, input.interventionLng, depots)
  if (!depart) return null

  const pepinster = findPepinster(depots)

  // Calcul km depanneuse selon scenario
  // d1 et dRetour calcules separement car les routes aller != retour
  // (autoroute, sens unique, etc.) -> Google donne 2 distances differentes.
  const d1       = await calculateRouteKm(depart.lat, depart.lng, input.interventionLat, input.interventionLng)
  const dRetour  = await calculateRouteKm(input.interventionLat, input.interventionLng, depart.lat, depart.lng)

  let kmDepanneuse = 0
  let kmLivraison  = 0
  const kmSegments: Array<{ label: string; km: number }> = []

  // Stops chauffeur (extra_addresses), filtre sur ceux qui ont des coords
  const stops = (input.stops || [])
    .filter(s => s.lat != null && s.lng != null)
    .map(s => ({ lat: Number(s.lat), lng: Number(s.lng), label: s.label || 'Stop' }))

  if (input.scenario === 'rem_client'
      && input.destinationLat != null && input.destinationLng != null) {
    // SNC : depart -> intervention -> [stops...] -> destination -> depart
    let prev = { lat: input.interventionLat, lng: input.interventionLng, label: 'intervention' }
    let total = d1
    kmSegments.push({ label: `${depart.name} → intervention`, km: d1 })
    for (const s of stops) {
      const seg = await calculateRouteKm(prev.lat, prev.lng, s.lat, s.lng)
      total += seg
      kmSegments.push({ label: `${prev.label} → ${s.label}`, km: seg })
      prev = s
    }
    const d2 = await calculateRouteKm(prev.lat, prev.lng, input.destinationLat, input.destinationLng)
    const d3 = await calculateRouteKm(input.destinationLat, input.destinationLng, depart.lat, depart.lng)
    total += d2 + d3
    kmSegments.push(
      { label: `${prev.label} → destination`,    km: d2 },
      { label: `destination → ${depart.name}`,   km: d3 },
    )
    kmDepanneuse = total
  } else if (input.scenario === 'rem_direct'
             && input.destinationLat != null && input.destinationLng != null) {
    // SC rem_direct (Olivier 2026-06-02 PM v3, formule finale) :
    //   - km_depanneuse = depart -> intervention -> depart
    //                     INTEGRALEMENT couvert par le forfait SC.
    //                     Calcule pour info uniquement (affichage), pas facture.
    //   - km_livraison  = depart -> [stops...] -> destination -> depart
    //                     SEUL segment facture, au tarif km de l ASSISTANCE
    //                     facturee (Touring, VAB...), moins km inclus
    //                     dans son forfait remorquage.
    //                     Inclut les stops chauffeur (extra_addresses).
    kmDepanneuse = d1 + dRetour
    kmSegments.push(
      { label: `Dépannage  ${depart.name} → intervention (couvert forfait SC)`,  km: d1 },
      { label: `Dépannage  intervention → ${depart.name} (couvert forfait SC)`,  km: dRetour },
    )
    let prev = { lat: depart.lat, lng: depart.lng, label: depart.name }
    let totalLiv = 0
    for (const s of stops) {
      const seg = await calculateRouteKm(prev.lat, prev.lng, s.lat, s.lng)
      totalLiv += seg
      kmSegments.push({ label: `Livraison  ${prev.label} → ${s.label}`, km: seg })
      prev = s
    }
    const dToDest    = await calculateRouteKm(prev.lat, prev.lng, input.destinationLat, input.destinationLng)
    const dFromDest  = await calculateRouteKm(input.destinationLat, input.destinationLng, depart.lat, depart.lng)
    totalLiv += dToDest + dFromDest
    kmSegments.push(
      { label: `Livraison  ${prev.label} → destination`,                         km: dToDest },
      { label: `Livraison  destination → ${depart.name}`,                        km: dFromDest },
    )
    kmLivraison = totalLiv
  } else if (input.scenario === 'rem_depot' && pepinster) {
    // depart -> intervention -> [stops...] -> Pepinster -> depart
    let prev = { lat: input.interventionLat, lng: input.interventionLng, label: 'intervention' }
    let total = d1
    kmSegments.push({ label: `${depart.name} → intervention`, km: d1 })
    for (const s of stops) {
      const seg = await calculateRouteKm(prev.lat, prev.lng, s.lat, s.lng)
      total += seg
      kmSegments.push({ label: `${prev.label} → ${s.label}`, km: seg })
      prev = s
    }
    const d2 = await calculateRouteKm(prev.lat, prev.lng, pepinster.lat, pepinster.lng)
    total += d2
    kmSegments.push({ label: `${prev.label} → ${pepinster.name}`, km: d2 })
    const d3 = depart.id === pepinster.id
      ? 0
      : await calculateRouteKm(pepinster.lat, pepinster.lng, depart.lat, depart.lng)
    if (d3 > 0) {
      total += d3
      kmSegments.push({ label: `${pepinster.name} → ${depart.name}`, km: d3 })
    }
    kmDepanneuse = total
  } else {
    // dsp (pas de stops applicables, DSP = sur place)
    // ou rem_depot sans Pepinster configure : depart -> intervention -> depart
    kmDepanneuse = d1 + dRetour
    kmSegments.push(
      { label: `${depart.name} → intervention`,  km: d1 },
      { label: `intervention → ${depart.name}`,  km: dRetour },
    )
  }

  // Km balisage : le balisage part toujours de Pepinster OU Aywaille (le plus
  // proche de l intervention parmi ces 2 depots), pas du meme depot que la
  // depanneuse. Il fait aller-retour intervention puis rentre directement.
  // Olivier 2026-06-02 PM : choix du depot balisage par DISTANCE ROUTE
  // (findNearestDepotByRoute) au lieu de haversine, pour coherence avec le
  // depot principal et pour eviter les mauvais choix sur autoroutes en sens
  // unique.
  let kmBalisage = 0
  let balisageDepotInfo: { name: string; id: number | string } | null = null
  if (input.requiresBalisage) {
    const balisageDepots = findBalisageDepots(depots)
    const balisageDepot = await findNearestDepotByRoute(input.interventionLat, input.interventionLng, balisageDepots)
    if (balisageDepot) {
      balisageDepotInfo = { name: balisageDepot.name, id: balisageDepot.id }
      const bal1 = await calculateRouteKm(balisageDepot.lat, balisageDepot.lng, input.interventionLat, input.interventionLng)
      const bal2 = await calculateRouteKm(input.interventionLat, input.interventionLng, balisageDepot.lat, balisageDepot.lng)
      kmBalisage = bal1 + bal2
      kmSegments.push(
        { label: `Balisage   ${balisageDepot.name} → intervention`,  km: bal1 },
        { label: `Balisage   intervention → ${balisageDepot.name}`,  km: bal2 },
      )
    }
  }

  const isMajored = await isSncMajored(input.interventionAt)

  // SC + rem_direct : lookup tarif assistance facturee (km_price + km_inclus)
  let livKmPrice: number | null  = null
  let livKmInclus: number        = 0
  let livAssistance: string | null = null
  if (input.scenario === 'rem_direct' && kmLivraison > 0 && (input.billedToId || input.billedToName)) {
    const at = await findAssistanceTariff({
      billedToId:   input.billedToId,
      billedToName: input.billedToName,
    })
    if (at) {
      livKmPrice    = at.km_price
      livKmInclus   = at.km_inclus
      livAssistance = at.assistance_name
    }
  }

  return {
    depart_depot:        depart.name,
    depart_depot_id:     depart.id,
    balisage_depot:      balisageDepotInfo?.name,
    balisage_depot_id:   balisageDepotInfo?.id,
    km_depanneuse:       kmDepanneuse,
    km_livraison:        kmLivraison > 0 ? kmLivraison : undefined,
    livraison_km_price:  livKmPrice,
    livraison_km_inclus: livKmInclus,
    livraison_assistance: livAssistance,
    km_balisage:         kmBalisage,
    km_segments:         kmSegments,
    is_majored:          isMajored,
    note: `Dépôt dépanneuse : ${depart.name}. Km dépanneuse : ${kmDepanneuse}.` +
          (input.interventionAt
            ? ` Intervention : ${typeof input.interventionAt === 'string' ? input.interventionAt : input.interventionAt.toISOString()}.`
            : ' Intervention : (date manquante).') +
          (kmLivraison > 0
            ? ` Km livraison (SC rem_direct) : ${kmLivraison}` +
              (livAssistance ? ` (assistance ${livAssistance}, ${livKmInclus} km inclus, ${livKmPrice}€/km)` : ' (assistance non identifiée, fallback tarif standard)') +
              '.'
            : '') +
          (input.requiresBalisage && balisageDepotInfo
            ? ` Dépôt balisage : ${balisageDepotInfo.name}. Km balisage : ${kmBalisage}.`
            : '') +
          (isMajored ? ' Plage horaire majorée appliquée.' : ''),
  }
}

/** Construit les lignes de devis SNC selon metrics + balisage. */
export interface SncQuoteLine {
  kind:       string  // SIAREM | SIAKIL | SIABAL | PECSIAMAJ | SIAKILMAJ | SIABALMAJ
  name:       string
  qty:        number
  price_unit: number
}

export function buildSncQuoteLines(opts: {
  metrics:           SncCalcOutput
  requiresBalisage:  boolean
  missionRef:        string
  /** 'snc' (defaut) = avec km. 'sc' = Siabis Couvert, forfait sans km. */
  variant?:          'snc' | 'sc'
}): SncQuoteLine[] {
  const lines: SncQuoteLine[] = []
  const { metrics, requiresBalisage, missionRef } = opts
  const variant = opts.variant || 'snc'
  const m = metrics.is_majored
  const variantLabel = variant === 'sc' ? 'SC' : 'SNC'

  // 1. Prise en charge (PEC)
  lines.push({
    kind:       m ? 'PECSIAMAJ' : 'SIAREM',
    name:       `Prise en charge ${variantLabel}${m ? ' (heures majorées)' : ''} — ${missionRef}`,
    qty:        1,
    price_unit: m ? 242.98 : 161.98,
  })

  // 2. Kilometres depanneuse :
  //    - SNC : facture tous les km au tarif depanneuse
  //    - SC  : 30 km inclus dans le forfait. Facture uniquement le surplus
  //            au tarif 1.0744 normal / 1.6529 majore.
  //      Olivier 2026-05-26 : "Pour Siabis couvert, on va compter le forfait
  //      incluant 30kms totaux. Le surplus de kilometre est facture au tarif
  //      de 1,0744eur htva en non majore et 1,6529eur htva en majore".
  // SC + rem_direct : pas de surplus km depanneuse (le forfait SC couvre
  // INTEGRALEMENT le segment depot-intervention-depot, peu importe les km).
  // Olivier 2026-06-02 PM : "pas de kilometre a compter uniquement le forfait".
  const isScRemDirect = variant === 'sc' && metrics.km_livraison && metrics.km_livraison > 0

  if (variant === 'snc' && metrics.km_depanneuse > 0) {
    lines.push({
      kind:       m ? 'SIAKILMAJ' : 'SIAKIL',
      name:       `Kilomètre dépanneuse${m ? ' (majoré)' : ''}`,
      qty:        metrics.km_depanneuse,
      price_unit: m ? 1.65 : 1.0744,
    })
  } else if (variant === 'sc' && !isScRemDirect && metrics.km_depanneuse > 30) {
    // SC standard (dsp / rem_depot) : 30 km inclus dans le forfait, surplus facture.
    const surplus = metrics.km_depanneuse - 30
    lines.push({
      kind:       m ? 'SIAKILMAJ' : 'SIAKIL',
      name:       `Kilomètre dépanneuse (au-delà des 30 km inclus)${m ? ' (majoré)' : ''}`,
      qty:        surplus,
      price_unit: m ? 1.6529 : 1.0744,
    })
  }

  // SC + rem_direct (Olivier 2026-06-02 PM, formule corrigee) : km livraison
  // = (depot -> intervention -> depot) + (depot -> destination -> depot),
  // facture au tarif km de l ASSISTANCE facturee, en deduisant les km inclus
  // dans son forfait remorquage (Touring 20, VAB 40, etc.).
  // Si l assistance n est pas identifiable, fallback sur SIAKIL standard.
  //
  // Olivier 2026-06-02 PM : sur la facture, label simple = "Relivraison".
  // Le detail du calcul (km, inclus, tarif assistance) est visible dans
  // l estimation du dispatch mais N APPARAIT PAS sur la facture Odoo.
  if (isScRemDirect && metrics.km_livraison) {
    const kmSurplus = Math.max(0, metrics.km_livraison - (metrics.livraison_km_inclus ?? 0))
    if (kmSurplus > 0) {
      const unitPrice = metrics.livraison_km_price && metrics.livraison_km_price > 0
        ? metrics.livraison_km_price
        : (m ? 1.6529 : 1.0744)
      lines.push({
        kind:       'SIAKIL', // tarif assistance, pas SIAKIL standard SNC
        name:       `Relivraison`,
        qty:        kmSurplus,
        price_unit: unitPrice,
      })
    }
  }

  // 3. Balisage (si applicable)
  if (requiresBalisage) {
    lines.push({
      kind:       m ? 'SIABALMAJ' : 'SIABAL',
      name:       `Supplément balisage${m ? ' (majoré)' : ''}`,
      qty:        1,
      price_unit: m ? 175.21 : 150,
    })
    // Km balisage : SNC seulement (SC = pas de km du tout)
    if (variant === 'snc' && metrics.km_balisage > 0) {
      lines.push({
        kind:       m ? 'SIAKILMAJ' : 'SIAKIL',
        name:       `Kilomètre balisage${m ? ' (majoré)' : ''}`,
        qty:        metrics.km_balisage,
        price_unit: m ? 1.65 : 1.0744,
      })
    }
  }

  return lines
}
