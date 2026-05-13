// src/app/api/missions/[id]/km/route.ts
//
// Calcule les kilomètres d'une mission via Google Directions API.
// Itinéraire :
//   - DSP / réparation sur place / trajet vide : depot → incident → depot
//   - REM (avec destination)                   : depot → incident → [stops...] → depot
//   Si extra_addresses contient des stops avec lat/lng, ils sont inclus en
//   séquence. Le dernier stop est l'arrivée. Sinon fallback sur destination_lat/lng
//   ou destination_address (sans coords → segment manqué + warning).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

const GMAPS_KEY = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!

type Coord = { lat: number; lng: number }

// Migration legacy Directions API → Routes API (mai 2026 : Google a depreche
// l'ancien endpoint /maps/api/directions/json pour les nouveaux projets).
// Doc : https://developers.google.com/maps/documentation/routes/compute_route_directions
async function getDistanceKm(origin: Coord, destination: Coord): Promise<number | null> {
  if (!GMAPS_KEY) {
    console.error('[km] GMAPS_KEY non configuree')
    return null
  }
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'X-Goog-Api-Key':    GMAPS_KEY,
        'X-Goog-FieldMask':  'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin:      { location: { latLng: { latitude: origin.lat,      longitude: origin.lng      } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode:  'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error(`[km] Routes API ${res.status}: ${text.slice(0, 300)}`)
      return null
    }
    const data = await res.json()
    const meters = data.routes?.[0]?.distanceMeters
    if (typeof meters !== 'number') {
      console.error('[km] Routes API: pas de distance dans la reponse', JSON.stringify(data).slice(0, 200))
      return null
    }
    return meters / 1000
  } catch (e: any) {
    console.error('[km] fetch failed:', e.message)
    return null
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  // SELECT * pour être robuste aux colonnes manquantes (destination_lat/lng peut ne pas exister)
  const { data: mission, error } = await sb
    .from('incoming_missions')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()
  if (error)   return NextResponse.json({ error: error.message }, { status: 500 })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (mission.incident_lat == null || mission.incident_lng == null) {
    return NextResponse.json({ error: 'Coordonnées incident manquantes' }, { status: 400 })
  }
  const incident: Coord = { lat: Number(mission.incident_lat), lng: Number(mission.incident_lng) }

  // Dépôt — soit celui de la mission, soit le défaut
  let depot: Coord | null = null
  let depotName = ''
  if (mission.depot_depart_id) {
    const { data: d } = await sb.from('depots').select('name, lat, lng').eq('id', mission.depot_depart_id).maybeSingle()
    if (d?.lat != null && d.lng != null) { depot = { lat: Number(d.lat), lng: Number(d.lng) }; depotName = d.name }
  }
  if (!depot) {
    const { data: d } = await sb.from('depots').select('name, lat, lng').eq('is_default', true).eq('active', true).maybeSingle()
    if (d?.lat != null && d.lng != null) { depot = { lat: Number(d.lat), lng: Number(d.lng) }; depotName = d.name }
  }
  if (!depot) return NextResponse.json({ error: 'Aucun dépôt configuré ou sans coordonnées' }, { status: 400 })

  const noDest = ['depannage', 'reparation_place', 'trajet_vide'].includes((mission.mission_type || '').toLowerCase())

  // Construire la liste des stops avec coords (extra_addresses)
  const rawStops: Array<{ id: string; label?: string; address: string; lat: number | null; lng: number | null; sort_order: number; type?: string }>
    = Array.isArray(mission.extra_addresses) ? mission.extra_addresses : []
  const stopsOrdered = [...rawStops].sort((a, b) => a.sort_order - b.sort_order)
  const stopsWithCoords: { label: string; coord: Coord }[] = stopsOrdered
    .filter(s => s.lat != null && s.lng != null)
    .map(s => ({ label: s.label || s.address, coord: { lat: Number(s.lat), lng: Number(s.lng) } }))

  // Destination finale (utilisée si REM et pas de stops, ou pour fermer la boucle)
  const destLat = (mission as any).destination_lat
  const destLng = (mission as any).destination_lng
  const destinationFromField: Coord | null = !noDest && destLat != null && destLng != null
    ? { lat: Number(destLat), lng: Number(destLng) }
    : null

  type Segment = { label: string; km: number | null }
  const segments: Segment[] = []

  // Aller : depot → incident
  const outbound = await getDistanceKm(depot, incident)
  segments.push({ label: `${depotName} → incident`, km: outbound })

  if (noDest) {
    // DSP : retour direct depot
    const back = await getDistanceKm(incident, depot)
    segments.push({ label: `incident → ${depotName}`, km: back })
  } else {
    // REM : incident → stops séquentiels → depot
    let prev = incident
    let prevLabel = 'incident'
    for (let i = 0; i < stopsWithCoords.length; i++) {
      const s = stopsWithCoords[i]
      const km = await getDistanceKm(prev, s.coord)
      segments.push({ label: `${prevLabel} → ${s.label}`, km })
      prev = s.coord
      prevLabel = s.label
    }
    // Si pas de stops mais une destination_lat/lng, l'utiliser
    if (stopsWithCoords.length === 0 && destinationFromField) {
      const km = await getDistanceKm(incident, destinationFromField)
      segments.push({ label: 'incident → destination', km })
      prev = destinationFromField
      prevLabel = 'destination'
    }
    // Retour depot
    const back = await getDistanceKm(prev, depot)
    segments.push({ label: `${prevLabel} → ${depotName}`, km: back })
  }

  const total = segments.reduce((sum, s) => sum + (s.km || 0), 0)
  const allOk = segments.every(s => s.km != null)

  return NextResponse.json({
    total_km:        Math.round(total * 10) / 10,
    segments:        segments.map(s => ({ label: s.label, km: s.km != null ? Math.round(s.km * 10) / 10 : null })),
    has_destination: !noDest,
    has_stops:       stopsWithCoords.length > 0,
    error:           allOk ? null : 'Certains segments n\'ont pas pu être calculés',
  })
}
