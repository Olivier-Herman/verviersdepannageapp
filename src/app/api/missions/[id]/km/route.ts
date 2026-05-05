// src/app/api/missions/[id]/km/route.ts
//
// Calcule les kilomètres d'une mission via Google Directions API.
// Itinéraire :
//   - DSP / réparation sur place / trajet vide : depot → incident → depot
//   - REM (avec destination)                   : depot → incident → destination → depot
// Retourne le détail par segment + total.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

const GMAPS_KEY = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!

type Coord = { lat: number; lng: number }

async function getDistanceKm(origin: Coord, destination: Coord): Promise<number | null> {
  if (!GMAPS_KEY) return null
  const url = `https://maps.googleapis.com/maps/api/directions/json` +
              `?origin=${origin.lat},${origin.lng}` +
              `&destination=${destination.lat},${destination.lng}` +
              `&mode=driving&key=${GMAPS_KEY}`
  try {
    const res  = await fetch(url)
    const data = await res.json()
    const meters = data.routes?.[0]?.legs?.[0]?.distance?.value
    return typeof meters === 'number' ? meters / 1000 : null
  } catch {
    return null
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('mission_type, incident_lat, incident_lng, destination_lat, destination_lng, depot_depart_id')
    .eq('id', params.id).single()
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
  const hasDest = !noDest && mission.destination_lat != null && mission.destination_lng != null
  const destination: Coord | null = hasDest
    ? { lat: Number(mission.destination_lat), lng: Number(mission.destination_lng) }
    : null

  const segments: Array<{ label: string; km: number | null }> = []

  // Aller : depot → incident
  const outbound = await getDistanceKm(depot, incident)
  segments.push({ label: `${depotName} → incident`, km: outbound })

  if (destination) {
    // REM : incident → destination → depot
    const toDestination = await getDistanceKm(incident, destination)
    segments.push({ label: 'incident → destination', km: toDestination })
    const back = await getDistanceKm(destination, depot)
    segments.push({ label: `destination → ${depotName}`, km: back })
  } else {
    // DSP : incident → depot (retour)
    const back = await getDistanceKm(incident, depot)
    segments.push({ label: `incident → ${depotName}`, km: back })
  }

  const total = segments.reduce((sum, s) => sum + (s.km || 0), 0)
  const allOk = segments.every(s => s.km != null)

  return NextResponse.json({
    total_km:    Math.round(total * 10) / 10,
    segments:    segments.map(s => ({ label: s.label, km: s.km != null ? Math.round(s.km * 10) / 10 : null })),
    has_destination: !!destination,
    error:       allOk ? null : 'Certains segments n\'ont pas pu être calculés',
  })
}
