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

import { NextResponse }                          from 'next/server'
import { getServerSession }                      from 'next-auth'
import { authOptions }                           from '@/lib/auth'
import { createAdminClient }                     from '@/lib/supabase'
import { isInDaySchedule, isInNightSchedule, isAutoDispatchNight }    from '@/lib/schedule'
import { ensureScheduleLoaded } from '@/lib/schedule-server'

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
// Migration vers Google Routes API (l'ancienne Directions API est depreciee
// pour les nouveaux projets Cloud). On demande les steps avec un fieldmask
// pour pouvoir capper la vitesse a 90 km/h sur les segments rapides.
async function getTruckEtaMinutes(origin: Coord, destination: Coord): Promise<number | null> {
  if (!GMAPS_KEY) {
    console.error('[driver-eta] GMAPS_KEY non configuree')
    return null
  }
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Goog-Api-Key':   GMAPS_KEY,
        // Demande les steps : distanceMeters + staticDuration (sans trafic, pour reproductibilite)
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration',
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
      console.error(`[driver-eta] Routes API ${res.status}: ${text.slice(0, 300)}`)
      return null
    }
    const data = await res.json()
    const steps = data.routes?.[0]?.legs?.[0]?.steps
    if (!Array.isArray(steps) || steps.length === 0) {
      // Fallback : pas de steps → utiliser duree totale brute
      const totalMeters  = data.routes?.[0]?.distanceMeters
      const totalDuration = data.routes?.[0]?.duration  // format "1234s"
      if (typeof totalMeters !== 'number' || !totalDuration) return null
      const totalSec = parseInt(String(totalDuration).replace('s', ''))
      const speedKmh = (totalMeters / 1000) / (totalSec / 3600)
      const TRUCK_MAX_KMH = 90
      const adjustedSec = speedKmh > TRUCK_MAX_KMH
        ? (totalMeters / 1000) / TRUCK_MAX_KMH * 3600
        : totalSec
      return Math.round(adjustedSec / 60)
    }

    const TRUCK_MAX_KMH = 90
    let totalSec = 0
    for (const step of steps) {
      const distM = step.distanceMeters || 0
      // staticDuration au format "1234s"
      const durSec = parseInt(String(step.staticDuration || '0s').replace('s', '')) || 0
      if (durSec === 0) continue
      const speedKmh = (distM / 1000) / (durSec / 3600)
      if (speedKmh > TRUCK_MAX_KMH) {
        totalSec += (distM / 1000) / TRUCK_MAX_KMH * 3600
      } else {
        totalSec += durSec
      }
    }
    return Math.round(totalSec / 60)
  } catch (e: any) {
    console.error('[driver-eta] fetch failed:', e.message)
    return null
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Olivier 2026-06-03 : load les plages de garde configurables depuis BDD
  // (cache 60s). No-op si recemment loadees.
  await ensureScheduleLoaded()

  const sb = createAdminClient()
  const url = new URL(req.url)

  // Olivier 2026-06-03 : include_off_duty=1 → garde les chauffeurs hors
  // service dans la reponse (grises cote DriverPickerModal). Sans le flag,
  // comportement strict (filtre) pour l auto-dispatch.
  const includeOffDuty = url.searchParams.get('include_off_duty') === '1'

  // Coords passees en query par le modal (form state, toujours frais) prioritaires.
  // Sinon fallback sur les valeurs DB (utile si on cale-back depuis un autre contexte).
  const queryLat = url.searchParams.get('lat')
  const queryLng = url.searchParams.get('lng')
  let incident: Coord | null = null
  if (queryLat && queryLng) {
    const lat = Number(queryLat), lng = Number(queryLng)
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) incident = { lat, lng }
  }

  if (!incident) {
    const { data: mission } = await sb
      .from('incoming_missions')
      .select('id, incident_lat, incident_lng')
      .eq('id', params.id)
      .single()
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
    if (mission.incident_lat == null || mission.incident_lng == null) {
      return NextResponse.json({ error: 'Lieu d\'incident sans coordonnees' }, { status: 400 })
    }
    incident = { lat: Number(mission.incident_lat), lng: Number(mission.incident_lng) }
  }

  // Chauffeurs disponibles pour assignation : users actifs avec role 'driver'
  // (ou admin/superadmin pour pouvoir s'auto-assigner). Le filtre legacy
  // towsoft_name a ete retire (Towsoft en voie de decommissionnement).
  const { data: drivers } = await sb
    .from('users')
    .select('id, name, avatar_url, last_location_lat, last_location_lng, location_updated_at, schedule_day, schedule_night, priority_order, phone')
    .eq('active', true)
    .or('role.in.(driver,admin,superadmin),roles.ov.{driver,admin,superadmin}')
    .order('priority_order', { ascending: true, nullsFirst: false })
    .order('name')
  if (!drivers || drivers.length === 0) return NextResponse.json({ drivers: [] })

  // Missions actives (assignees mais pas terminees) pour determiner le statut
  const { data: activeMissions } = await sb
    .from('incoming_missions')
    .select('id, assigned_to, dossier_number, mission_type, destination_address, destination_lat, destination_lng, incident_address, incident_lat, incident_lng, status')
    .in('status', ['assigned', 'accepted', 'on_way', 'on_site', 'in_progress', 'delivering'])
    .neq('id', params.id)
  const missionsByDriver = new Map<string, any>()
  for (const m of (activeMissions || [])) {
    if (m.assigned_to) missionsByDriver.set(m.assigned_to, m)
  }

  const now    = Date.now()
  const nowDt  = new Date(now)
  const enriched = await Promise.all(drivers.map(async (d) => {
    const locAge = d.location_updated_at
      ? Math.floor((now - new Date(d.location_updated_at).getTime()) / 1000)
      : null
    const hasPosition = d.last_location_lat != null && d.last_location_lng != null
    const isFresh     = locAge != null && locAge < ACTIVE_WINDOW_MIN * 60

    const activeMission = missionsByDriver.get(d.id)

    // En service si planning de garde actif (schedule_day en journee OU
    // schedule_night la nuit). Cohabite avec ping recent + mission active.
    const inDayShift   = !!d.schedule_day   && isInDaySchedule(nowDt)
    const inNightShift = !!d.schedule_night && isInNightSchedule(nowDt)
    const onSchedule   = inDayShift || inNightShift

    // Filtrage "hors service" : pas de ping recent ET pas en mission active
    // ET pas de garde forcee.
    // Olivier 2026-06-03 : si include_off_duty=1, on garde les off-duty
    // pour les afficher grises cote DriverPickerModal. L auto-dispatch n appelle
    // PAS avec ce flag pour rester strict (jamais d auto-dispatch sur un
    // chauffeur pas de garde).
    const isOnDuty = isFresh || !!activeMission || onSchedule
    if (!isOnDuty && !includeOffDuty) return null

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

    // Calcul ETA total et distance pour le tri
    // - Libre : position → incident
    // - En mission : position → destination + 10min decharge + destination → incident
    const UNLOAD_MIN = 10  // temps decharge / fin intervention (paramétrable plus tard /admin/settings)
    let etaTotalMin: number | null = null
    if (activeMission) {
      const toDest = currentMission?.eta_to_destination_min
      const destToInc = currentMission?.eta_destination_to_incident_min
      if (toDest != null && destToInc != null) {
        etaTotalMin = toDest + UNLOAD_MIN + destToInc
      }
    } else {
      etaTotalMin = etaPositionToIncident
    }

    return {
      id:                       d.id,
      name:                     d.name,
      avatar_url:               d.avatar_url,
      has_position:             hasPosition,
      location_age_seconds:     locAge,
      is_fresh:                 isFresh,
      is_on_duty:               isOnDuty,        // Olivier 2026-06-03
      is_on_schedule:           onSchedule,      // sur planning de garde
      status:                   activeMission ? 'on_mission' as const : 'free' as const,
      eta_to_incident_min:      etaPositionToIncident,
      eta_total_min:            etaTotalMin,    // NEW : ETA total avec decharge si en mission
      priority_order:           (d as any).priority_order ?? null,
      current_mission:          currentMission,
    }
  }))

  // Filtrer les nulls (hors service)
  const filtered = enriched.filter((x): x is NonNullable<typeof x> => x !== null)

  // Algo de selection en 2 passes (cf project_auto_dispatch_scenario.md) :
  //   1. best_eta = min des ETA totaux (libres + en mission unifies)
  //   2. Garder candidats avec eta_total <= best_eta + TOLERANCE
  //   3. Dans le sous-groupe, trier par eta_total ASC, tiebreaker priority_order
  // Cette logique remplace l'ancien tri "libres d'abord" qui ratait le cas
  // "chauffeur qui decharge a Aywaille dans 3 min" vs "chauffeur libre 25 min de Pepinster".
  const TOLERANCE_MIN = 10  // marge ETA pour preferer un chauffeur plus proche en km

  const withEta = filtered.filter(d => d.eta_total_min != null) as Array<typeof filtered[number] & { eta_total_min: number }>

  // Politique jour vs nuit (Olivier 2026-05-15) :
  // - JOUR : tri ETA-based (rapidité prime, tiebreaker priority_order)
  // - NUIT : tri strict priority_order (l ordre dispatcher prime, ETA secondaire)
  // La nuit, le dispatcher a configure l ordre operationnel via drag&drop
  // → l auto-dispatch respecte cet ordre meme si un autre chauffeur arrive
  // plus vite.
  const isNight = isAutoDispatchNight(nowDt)  // 18h-8h pour l'auto-dispatch

  if (withEta.length > 0) {
    if (isNight) {
      // Nuit : priority_order strict, tiebreaker eta_total
      withEta.sort((a, b) => {
        const aPrio = a.priority_order ?? Number.MAX_SAFE_INTEGER
        const bPrio = b.priority_order ?? Number.MAX_SAFE_INTEGER
        if (aPrio !== bPrio) return aPrio - bPrio
        return a.eta_total_min - b.eta_total_min
      })
    } else {
      // Jour : ETA ASC, tiebreaker priority_order
      withEta.sort((a, b) => {
        if (a.eta_total_min !== b.eta_total_min) return a.eta_total_min - b.eta_total_min
        const aPrio = a.priority_order ?? Number.MAX_SAFE_INTEGER
        const bPrio = b.priority_order ?? Number.MAX_SAFE_INTEGER
        return aPrio - bPrio
      })
    }
  }
  // Chauffeurs sans ETA computable (pas de position) → en fin de liste, triés par priority_order
  const withoutEta = filtered.filter(d => d.eta_total_min == null)
  withoutEta.sort((a, b) => (a.priority_order ?? Number.MAX_SAFE_INTEGER) - (b.priority_order ?? Number.MAX_SAFE_INTEGER))

  return NextResponse.json({
    drivers: [...withEta, ...withoutEta],
    best_eta_min: withEta.length > 0 ? Math.min(...withEta.map(d => d.eta_total_min)) : null,
    tolerance_min: TOLERANCE_MIN,
    sort_mode: isNight ? 'priority_order' : 'eta',
  })
}
