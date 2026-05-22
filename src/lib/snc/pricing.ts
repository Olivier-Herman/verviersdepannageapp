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
//   - rem_client : km depanneuse = depot -> intervention -> destination -> depot
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
  scenario:           'dsp' | 'rem_client' | 'rem_depot'
  requiresBalisage:   boolean
  interventionLat:    number | null
  interventionLng:    number | null
  destinationLat?:    number | null
  destinationLng?:    number | null
  interventionAt:     Date | string | null
  /** 'snc' (defaut) = avec km. 'sc' = Siabis Couvert, forfait sans km. */
  variant?:           'snc' | 'sc'
}

export interface SncCalcOutput {
  depart_depot:           string    // nom du depot depanneuse (le plus proche parmi tous)
  depart_depot_id:        number | string
  balisage_depot?:        string    // nom du depot balisage (Pepinster ou Aywaille, le plus proche)
  balisage_depot_id?:     number | string
  km_depanneuse:          number    // total km depanneuse (depot -> ... -> depot)
  km_balisage:            number    // km balisage (aller-retour intervention depuis SON depot)
  is_majored:             boolean
  note:                   string    // explication calcul (visible facturation)
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

/** Cherche le depot le plus proche du lieu d intervention (haversine). */
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
  // Le depot retour = depot de depart pour la depanneuse, MEME en REM depot
  // (la depanneuse revient a son depot d origine apres avoir depose a Pepinster).
  const depart = findNearestDepot(input.interventionLat, input.interventionLng, depots)
  if (!depart) return null

  const pepinster = findPepinster(depots)

  // Calcul km depanneuse selon scenario
  // d1 et dRetour calcules separement car les routes aller != retour
  // (autoroute, sens unique, etc.) -> Google donne 2 distances differentes.
  const d1       = await calculateRouteKm(depart.lat, depart.lng, input.interventionLat, input.interventionLng)
  const dRetour  = await calculateRouteKm(input.interventionLat, input.interventionLng, depart.lat, depart.lng)

  let kmDepanneuse = 0
  if (input.scenario === 'rem_client' && input.destinationLat != null && input.destinationLng != null) {
    // depart -> intervention -> destination -> depart
    const d2 = await calculateRouteKm(input.interventionLat, input.interventionLng, input.destinationLat, input.destinationLng)
    const d3 = await calculateRouteKm(input.destinationLat, input.destinationLng, depart.lat, depart.lng)
    kmDepanneuse = d1 + d2 + d3
  } else if (input.scenario === 'rem_depot' && pepinster) {
    // depart -> intervention -> Pepinster (mise en depot) -> depart (depanneuse rentre)
    const d2 = await calculateRouteKm(input.interventionLat, input.interventionLng, pepinster.lat, pepinster.lng)
    const d3 = depart.id === pepinster.id
      ? 0  // depart = Pepinster, pas de retour
      : await calculateRouteKm(pepinster.lat, pepinster.lng, depart.lat, depart.lng)
    kmDepanneuse = d1 + d2 + d3
  } else {
    // dsp (ou rem_depot sans Pepinster configure) : depart -> intervention -> depart
    kmDepanneuse = d1 + dRetour
  }

  // Km balisage : le balisage part toujours de Pepinster OU Aywaille (le plus
  // proche de l intervention parmi ces 2 depots), pas du meme depot que la
  // depanneuse. Il fait aller-retour intervention puis rentre directement.
  let kmBalisage = 0
  let balisageDepotInfo: { name: string; id: number | string } | null = null
  if (input.requiresBalisage) {
    const balisageDepots = findBalisageDepots(depots)
    const balisageDepot = findNearestDepot(input.interventionLat, input.interventionLng, balisageDepots)
    if (balisageDepot) {
      balisageDepotInfo = { name: balisageDepot.name, id: balisageDepot.id }
      const bal1 = await calculateRouteKm(balisageDepot.lat, balisageDepot.lng, input.interventionLat, input.interventionLng)
      const bal2 = await calculateRouteKm(input.interventionLat, input.interventionLng, balisageDepot.lat, balisageDepot.lng)
      kmBalisage = bal1 + bal2
    }
  }

  const isMajored = await isSncMajored(input.interventionAt)

  return {
    depart_depot:      depart.name,
    depart_depot_id:   depart.id,
    balisage_depot:    balisageDepotInfo?.name,
    balisage_depot_id: balisageDepotInfo?.id,
    km_depanneuse:     kmDepanneuse,
    km_balisage:       kmBalisage,
    is_majored:        isMajored,
    note: `Dépôt dépanneuse : ${depart.name}. Km dépanneuse : ${kmDepanneuse}.` +
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

  // 2. Kilometres depanneuse — SNC SEULEMENT (SC = forfait pur, pas de km)
  if (variant === 'snc' && metrics.km_depanneuse > 0) {
    lines.push({
      kind:       m ? 'SIAKILMAJ' : 'SIAKIL',
      name:       `Kilomètre dépanneuse${m ? ' (majoré)' : ''}`,
      qty:        metrics.km_depanneuse,
      price_unit: m ? 1.65 : 1.0744,
    })
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
