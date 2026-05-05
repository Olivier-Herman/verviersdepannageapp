// src/app/api/missions/[id]/driver-eta/route.ts
//
// Renvoie pour chaque chauffeur actif :
//   - position (lat/lng + age en secondes)
//   - statut (libre / en mission)
//   - ETA depuis position vers lieu d'incident (camion 90 km/h)
//   - Si en mission : destination courante + ETA jusqu'a destination + ETA destination -> incident
//
// Utilise par le modal "Assigner chauffeur" cote dispatch.
// Filtre les chauffeurs hors service (pas de ping recent ET pas en mission active).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

const GMAPS_KEY = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!

// Plage "actif" : ping recent dans les N minutes
const ACTIVE_WINDOW_MIN = 30

type Coord = { lat: number; lng: number }

/**
 * Calcule une duree de trajet "camion" en cappant la vitesse a 90 km/h sur les
 * segments rapides (autoroutes). On utilise Google Directions API pour avoir
 * le detail des steps, et on recalcule la duree de chaque step si la vitesse
 * implicite depasse 90 km/h.
 */
async function getTruckEtaMinutes(origin: Coord, destination: Coord): Promise<number | null> {
  if (!GMAPS_KEY) return null
  const url = `https://maps.googleapis.com/maps/api/directions/json` +
              `?origin=${origin.lat},${origin.lng}` +
              `&destination=${destination.lat},${destination.lng}` +
              `&mode=driving&key=${GMAPS_KEY}`
  try {
    const res  = await fetch(url)
    const data = await res.json()
    if (!data.routes?.[0]?.legs?.[0]?.steps) return null

    const TRUCK_MAX_KMH = 90
    let totalSec = 0
    for (const step of data.routes[0].legs[0].steps) {
      const distM  = step.distance?.value || 0
      const durSec = step.duration?.value || 0
      if (durSec === 0) continue
      const speedKmh = (distM / 1000) / (durSec / 3600)
      if (speedKmh > TRUCK_MAX_KMH) {
        totalSec += (distM / 1000) / TRUCK_MAX_KMH * 3600
      } else {
        totalSec += durSec
      }
    }
    return Math.round(totalSec / 60)
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
    .select('id, incident_lat, incident_lng')
    .eq('id', params.id)
    .single()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (mission.incident_lat == null || mission.incident_lng == null) {
    return NextResponse.json({ error: 'Lieu d\'incident sans coordonnees' }, { status: 400 })
  }
  const incident: Coord = { lat: Number(mission.incident_lat), lng: Number(mission.incident_lng) }

  // Tous les chauffeurs actifs (role driver/admin/superadmin, active=true)
  const { data: drivers } = await sb
    .from('users')
    .select('id, name, avatar_url, last_location_lat, last_location_lng, location_updated_at')
    .eq('active', true)
    .in('role', ['driver', 'admin', 'superadmin'])
    .order('name')
  if (!drivers || drivers.length === 0) return NextResponse.json({ drivers: [] })

  // Missions actives (assignees mais pas terminees) pour determiner le statut
  const { data: activeMissions } = await sb
    .from('incoming_missions')
    .select('id, assigned_to, dossier_number, mission_type, destination_address, destination_lat, destination_lng, incident_address, incident_lat, incident_lng, status')
    .in('status', ['assigned', 'accepted', 'on_way', 'on_site', 'in_progress'])
    .neq('id', params.id)
  const missionsByDriver = new Map<string, any>()
  for (const m of (activeMissions || [])) {
    if (m.assigned_to) missionsByDriver.set(m.assigned_to, m)
  }

  const now = Date.now()
  const enriched = await Promise.all(drivers.map(async (d) => {
    const locAge = d.location_updated_at
      ? Math.floor((now - new Date(d.location_updated_at).getTime()) / 1000)
      : null
    const hasPosition = d.last_location_lat != null && d.last_location_lng != null
    const isFresh     = locAge != null && locAge < ACTIVE_WINDOW_MIN * 60

    const activeMission = missionsByDriver.get(d.id)

    // Filtrage "hors service" : pas de ping recent ET pas en mission active
    if (!isFresh && !activeMission) return null

    const driverPos: Coord | null = hasPosition
      ? { lat: Number(d.last_location_lat), lng: Number(d.last_location_lng) }
      : null

    let etaPositionToIncident: number | null = null
    if (driverPos) {
      etaPositionToIncident = await getTruckEtaMinutes(driverPos, incident)
    }

    let currentMission: any = null
    if (activeMission) {
      // Destination = celle de la mission active si presente, sinon l'incident de cette mission
      const destLat = activeMission.destination_lat ?? activeMission.incident_lat
      const destLng = activeMission.destination_lng ?? activeMission.incident_lng
      const destAddr = activeMission.destination_address || activeMission.incident_address || ''
      const destCoord: Coord | null = destLat != null && destLng != null
        ? { lat: Number(destLat), lng: Number(destLng) }
        : null

      let etaToDestination: number | null = null
      let etaDestinationToIncident: number | null = null
      if (destCoord && driverPos) {
        etaToDestination = await getTruckEtaMinutes(driverPos, destCoord)
      }
      if (destCoord) {
        etaDestinationToIncident = await getTruckEtaMinutes(destCoord, incident)
      }

      currentMission = {
        id:                          activeMission.id,
        dossier_number:              activeMission.dossier_number,
        mission_type:                activeMission.mission_type,
        destination_address:         destAddr,
        eta_to_destination_min:      etaToDestination,
        eta_destination_to_incident_min: etaDestinationToIncident,
        status:                      activeMission.status,
      }
    }

    return {
      id:                       d.id,
      name:                     d.name,
      avatar_url:               d.avatar_url,
      has_position:             hasPosition,
      location_age_seconds:     locAge,
      is_fresh:                 isFresh,
      status:                   activeMission ? 'on_mission' : 'free',
      eta_to_incident_min:      etaPositionToIncident,
      current_mission:          currentMission,
    }
  }))

  // Filtrer les nulls (hors service) et trier : libres d'abord par ETA, puis en mission par ETA total
  const filtered = enriched.filter((x): x is NonNullable<typeof x> => x !== null)
  filtered.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'free' ? -1 : 1
    const aEta = a.status === 'free'
      ? (a.eta_to_incident_min ?? Infinity)
      : ((a.current_mission?.eta_to_destination_min ?? 0) + (a.current_mission?.eta_destination_to_incident_min ?? Infinity))
    const bEta = b.status === 'free'
      ? (b.eta_to_incident_min ?? Infinity)
      : ((b.current_mission?.eta_to_destination_min ?? 0) + (b.current_mission?.eta_destination_to_incident_min ?? Infinity))
    return aEta - bEta
  })

  return NextResponse.json({ drivers: filtered })
}
