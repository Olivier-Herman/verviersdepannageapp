// src/lib/googlemaps.ts
// Utilise GOOGLE_MAPS_SERVER_KEY (clé serveur sans restriction HTTP)
// pour Distance Matrix API côté serveur

export interface DistanceResult {
  distanceKm:  number
  durationMin: number
}

/**
 * Calcule la distance et la duree entre deux adresses via Google Routes API.
 *
 * Migration de l'ancienne Distance Matrix API (depreciee pour les nouveaux
 * projets Cloud → REQUEST_DENIED "legacy API") vers Routes API
 * (routes.googleapis.com/directions/v2:computeRoutes).
 *
 * Necessite GOOGLE_MAPS_SERVER_KEY (ou fallback NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).
 */
export async function getRouteDistance(
  origin:      string,
  destination: string
): Promise<DistanceResult> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!key) throw new Error('Clé Google Maps serveur non configurée (GOOGLE_MAPS_SERVER_KEY)')

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
    },
    body: JSON.stringify({
      origin:      { address: origin },
      destination: { address: destination },
      travelMode:  'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      languageCode: 'fr',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Routes API ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  const route = data.routes?.[0]
  if (!route || typeof route.distanceMeters !== 'number') {
    throw new Error('Routes API: pas de distance dans la reponse')
  }

  const durationSec = parseInt(String(route.duration || '0s').replace('s', '')) || 0

  return {
    distanceKm:  Math.ceil(route.distanceMeters / 1000),
    durationMin: Math.ceil(durationSec / 60),
  }
}

/**
 * Calcule la deadline selon la priorité TGR.
 * P1 : J+1 ouvrable avant midi
 * P2 : J+1 ouvrable dans la journée
 * P3 : ASAP
 */
export function calculateTGRDeadline(priority: 1 | 2 | 3): {
  date:  string | null
  slot:  'before_noon' | 'during_day' | 'asap'
  label: string
} {
  if (priority === 3) {
    return { date: null, slot: 'asap', label: 'Dès que possible' }
  }

  const slot: 'before_noon' | 'during_day' = priority === 1 ? 'before_noon' : 'during_day'

  const HOLIDAYS = ['01-01','05-01','07-21','08-15','11-01','11-11','12-25']

  function easter(year: number): Date {
    const a = year%19, b = Math.floor(year/100), c = year%100
    const d = Math.floor(b/4), e = b%4, f = Math.floor((b+8)/25)
    const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15)%30
    const i = Math.floor(c/4), k = c%4
    const l = (32+2*e+2*i-h-k)%7
    const m = Math.floor((a+11*h+22*l)/451)
    const month = Math.floor((h+l-7*m+114)/31)
    const day   = ((h+l-7*m+114)%31)+1
    return new Date(year, month-1, day)
  }

  function isBelgianHoliday(d: Date): boolean {
    const mm  = String(d.getMonth()+1).padStart(2,'0')
    const dd  = String(d.getDate()).padStart(2,'0')
    if (HOLIDAYS.includes(`${mm}-${dd}`)) return true
    const e  = easter(d.getFullYear())
    const add = (dt: Date, n: number) => { const r = new Date(dt); r.setDate(r.getDate()+n); return r }
    const fmt = (dt: Date) => `${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
    return [fmt(add(e,1)), fmt(add(e,39)), fmt(add(e,50))].includes(`${mm}-${dd}`)
  }

  const next = new Date()
  next.setDate(next.getDate()+1)
  while (next.getDay()===0 || isBelgianHoliday(next)) next.setDate(next.getDate()+1)

  const dateStr = next.toISOString().split('T')[0]
  const dayLabel = next.toLocaleDateString('fr-BE', { weekday:'long', day:'2-digit', month:'long' })
  const label = priority===1 ? `${dayLabel} avant midi` : `${dayLabel} dans la journée`

  return { date: dateStr, slot, label }
}
