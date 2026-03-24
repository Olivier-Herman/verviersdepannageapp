// src/lib/googlemaps.ts
// Calcul de distance via Google Maps Distance Matrix API

const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!

export interface DistanceResult {
  distanceKm:  number
  durationMin: number
  originText:  string
  destText:    string
}

/**
 * Calcule la distance routière entre deux adresses via Google Maps.
 */
export async function getRouteDistance(
  origin:      string,
  destination: string
): Promise<DistanceResult> {
  const params = new URLSearchParams({
    origins:      origin,
    destinations: destination,
    mode:         'driving',
    language:     'fr',
    key:          GOOGLE_API_KEY,
  })

  const res  = await fetch(
    `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`
  )
  const data = await res.json()

  if (data.status !== 'OK') {
    throw new Error(`Google Maps Distance Matrix error: ${data.status}`)
  }

  const element = data.rows[0]?.elements[0]
  if (!element || element.status !== 'OK') {
    throw new Error(`Impossible de calculer la distance: ${element?.status}`)
  }

  return {
    distanceKm:  Math.ceil(element.distance.value / 1000), // arrondi au km supérieur
    durationMin: Math.ceil(element.duration.value / 60),
    originText:  data.origin_addresses[0],
    destText:    data.destination_addresses[0],
  }
}

/**
 * Calcule la date deadline selon la priorité TGR.
 * P1 : J+1 ouvrable avant midi
 * P2 : J+1 ouvrable dans la journée
 * P3 : ASAP (pas de deadline fixe)
 */
export function calculateTGRDeadline(priority: 1 | 2 | 3): {
  date:      string | null  // ISO date YYYY-MM-DD
  slot:      'before_noon' | 'during_day' | 'asap'
  label:     string
} {
  if (priority === 3) {
    return { date: null, slot: 'asap', label: 'Dès que possible' }
  }

  const slot = priority === 1 ? 'before_noon' : 'during_day'

  // Trouver le prochain jour ouvrable
  const BELGIAN_HOLIDAYS = [
    '01-01','05-01','07-21','08-15','11-01','11-11','12-25'
  ]

  function getEaster(year: number): Date {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4), k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31)
    const day   = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(year, month - 1, day)
  }

  function isBelgianHoliday(date: Date): boolean {
    const mm  = String(date.getMonth() + 1).padStart(2, '0')
    const dd  = String(date.getDate()).padStart(2, '0')
    const key = `${mm}-${dd}`
    if (BELGIAN_HOLIDAYS.includes(key)) return true
    const easter = getEaster(date.getFullYear())
    const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
    const fmt = (d: Date) => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const mobile = [fmt(addDays(easter,1)), fmt(addDays(easter,39)), fmt(addDays(easter,50))]
    return mobile.includes(key)
  }

  function isWorkingDay(date: Date): boolean {
    return date.getDay() !== 0 && !isBelgianHoliday(date)
  }

  const next = new Date()
  next.setDate(next.getDate() + 1)
  while (!isWorkingDay(next)) next.setDate(next.getDate() + 1)

  const dateStr = next.toISOString().split('T')[0]
  const label = priority === 1
    ? `${next.toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long' })} avant midi`
    : `${next.toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long' })} dans la journée`

  return { date: dateStr, slot, label }
}
