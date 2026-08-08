// src/lib/routing/ors.ts
//
// Routage via OpenRouteService (OSM) — remplace Google Routes API (qui coûtait
// ~450 €/mois, sur-utilisée par l'ETA chauffeur). Google était en TRAFFIC_UNAWARE
// (pas de trafic) → ORS donne la même qualité, gratuitement.
//
// getDrivingRoute  : 1 origine → 1 destination (temps + distance routière).
// getDrivingMatrix : N origines → 1 destination en UNE requête (idéal driver-eta).
// Repli haversine si ORS indisponible / pas de clé / quota dépassé.
//
// Env : ORS_API_KEY. Olivier 2026-07-01.

export interface Coord { lat: number; lng: number }
export interface RouteResult { minutes: number; km: number; approx: boolean }

const ORS_KEY  = process.env.ORS_API_KEY
const ORS_BASE = 'https://api.openrouteservice.org'
const GMAPS_KEY = process.env.GOOGLE_MAPS_SERVER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

// Circuit breaker ORS : si ORS échoue 2× d'affilée, on bascule sur Google
// pendant un moment (au lieu de retomber sur le haversine approximatif). Google
// = routing précis, coûteux → on n'y va que quand ORS lâche.
let orsFails = 0
let orsBreakerUntil = 0
const ORS_BREAKER_MS = 3 * 60 * 1000

/** Routing précis via Google Routes API (coords). null si indispo/échec. */
async function googleDrivingRoute(a: Coord, b: Coord): Promise<RouteResult | null> {
  if (!GMAPS_KEY) return null
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   GMAPS_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin:      { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
        destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
        travelMode:  'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) throw new Error(`Google Routes ${res.status}`)
    const j = await res.json()
    const r = j.routes?.[0]
    if (!r || r.distanceMeters == null) return null
    const durSec = parseInt(String(r.duration || '0s').replace('s', '')) || 0
    return { minutes: Math.max(1, Math.round(durSec / 60)), km: Math.round(r.distanceMeters / 100) / 10, approx: false }
  } catch (e: any) {
    console.warn('[routing] google fallback KO:', e?.message)
    return null
  }
}

function haversineKm(a: Coord, b: Coord): number {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Repli : distance à vol d'oiseau × 1.3 (détour routier), ~70 km/h moyen.
function haversineRoute(a: Coord, b: Coord): RouteResult {
  const km = Math.round(haversineKm(a, b) * 1.3 * 10) / 10
  return { minutes: Math.max(1, Math.round((km / 70) * 60)), km, approx: true }
}

// Cache mémoire court : déduplique les paires répétées (réouvertures du picker,
// même dépôt→incident…) → moins d'appels ORS, respecte le quota gratuit.
const routeCache = new Map<string, { r: RouteResult; exp: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000
const cacheKey = (a: Coord, b: Coord) =>
  `${a.lat.toFixed(3)},${a.lng.toFixed(3)}>${b.lat.toFixed(3)},${b.lng.toFixed(3)}`

/**
 * Trajet routier 1→1 (temps min + distance km).
 * ORS d'abord (gratuit) ; après 2 échecs consécutifs → Google (précis) pendant
 * 3 min ; haversine seulement si Google échoue aussi.
 */
export async function getDrivingRoute(a: Coord, b: Coord, opts: { googleFallback?: boolean } = {}): Promise<RouteResult> {
  const k = cacheKey(a, b)
  const hit = routeCache.get(k)
  if (hit && hit.exp > Date.now()) return hit.r
  const cache = (r: RouteResult) => { routeCache.set(k, { r, exp: Date.now() + CACHE_TTL_MS }); if (routeCache.size > 2000) routeCache.clear(); return r }

  // 1) ORS, sauf si le breaker est ouvert (2 échecs récents).
  const orsAllowed = ORS_KEY && Date.now() >= orsBreakerUntil
  if (orsAllowed) {
    try {
      const res = await fetch(`${ORS_BASE}/v2/directions/driving-car`, {
        method:  'POST',
        headers: { Authorization: ORS_KEY as string, 'Content-Type': 'application/json' },
        // « fastest » = itinéraire le plus RAPIDE (comme le chauffeur/Waze),
        // pas le plus court. Ce qui compte = faire attendre le client le moins
        // longtemps. Olivier 2026-08-08.
        body:    JSON.stringify({ coordinates: [[a.lng, a.lat], [b.lng, b.lat]], preference: 'fastest' }),
        signal:  AbortSignal.timeout(2500),
      })
      if (!res.ok) throw new Error(`ORS ${res.status}`)
      const j = await res.json()
      const s = j.routes?.[0]?.summary
      if (!s || s.distance == null) throw new Error('no route')
      orsFails = 0
      return cache({ minutes: Math.max(1, Math.round(s.duration / 60)), km: Math.round(s.distance / 100) / 10, approx: false })
    } catch (e: any) {
      orsFails++
      if (orsFails >= 2) { orsBreakerUntil = Date.now() + ORS_BREAKER_MS; orsFails = 0 }
      console.warn('[ors] échec, bascule Google:', e?.message)
    }
  }

  // 2) Google (précis) quand ORS lâche — UNIQUEMENT pour la facturation
  //    (opt-in). Le driver-ETA et l'estimation police restent sur haversine.
  if (opts.googleFallback) {
    const g = await googleDrivingRoute(a, b)
    if (g) return cache(g)
  }

  // 3) Dernier recours : estimation à vol d'oiseau.
  return haversineRoute(a, b)
}

/** Matrice N origines → 1 destination, en UNE requête. Repli haversine par point. */
export async function getDrivingMatrix(origins: Coord[], dest: Coord): Promise<RouteResult[]> {
  if (!ORS_KEY || origins.length === 0) return origins.map(o => haversineRoute(o, dest))
  try {
    const locations = [...origins.map(o => [o.lng, o.lat]), [dest.lng, dest.lat]]
    const destIdx = origins.length
    const res = await fetch(`${ORS_BASE}/v2/matrix/driving-car`, {
      method:  'POST',
      headers: { Authorization: ORS_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ locations, sources: origins.map((_, i) => i), destinations: [destIdx], metrics: ['duration', 'distance'] }),
      signal:  AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`ORS matrix ${res.status}`)
    const j = await res.json()
    return origins.map((o, i) => {
      const dur = j.durations?.[i]?.[0], dist = j.distances?.[i]?.[0]
      if (dur == null || dist == null) return haversineRoute(o, dest)
      return { minutes: Math.max(1, Math.round(dur / 60)), km: Math.round(dist / 100) / 10, approx: false }
    })
  } catch (e: any) {
    console.warn('[ors] matrix fallback:', e?.message)
    return origins.map(o => haversineRoute(o, dest))
  }
}
