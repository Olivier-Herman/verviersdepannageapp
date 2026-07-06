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
import { getDrivingMatrix } from '@/lib/routing/ors'

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
// Cap camion 90 km/h : si la vitesse moyenne dépasse 90 (autoroute), on recalcule.
function truckCapMinutes(r: { minutes: number; km: number }): number {
  const hours = r.minutes / 60
  const avg = hours > 0 ? r.km / hours : 0
  return avg > 90 ? Math.round((r.km / 90) * 60) : r.minutes
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
    // Olivier 2026-07-06 : on NE bloque plus l'assignation quand l'ETA est
    // incalculable (mission introuvable OU lieu sans coordonnees). Avant, on
    // renvoyait une erreur qui masquait TOUTE la liste cote DriverPickerModal
    // (« impossible de trouver un chauffeur »). Desormais : incident reste null,
    // on liste tous les chauffeurs sans ETA, le dispatcher choisit a la main.
    if (mission && mission.incident_lat != null && mission.incident_lng != null) {
      incident = { lat: Number(mission.incident_lat), lng: Number(mission.incident_lng) }
    }
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
    .select('id, assigned_to, dossier_number, mission_type, destination_address, destination_lat, destination_lng, incident_address, incident_lat, incident_lng, status, assigned_at')
    .in('status', ['assigned', 'accepted', 'on_way', 'on_site', 'in_progress', 'delivering'])
    .neq('id', params.id)
    .order('assigned_at', { ascending: true, nullsFirst: true })
  // Olivier 2026-06-17 : un chauffeur peut avoir PLUSIEURS missions actives →
  // on les garde toutes (avant : Map écrasée = 1 seule mission notée).
  const missionsByDriver = new Map<string, any[]>()
  for (const m of (activeMissions || [])) {
    if (!m.assigned_to) continue
    const arr = missionsByDriver.get(m.assigned_to) || []
    arr.push(m)
    missionsByDriver.set(m.assigned_to, arr)
  }

  const now    = Date.now()
  const nowDt  = new Date(now)
  // On ne calcule l'ETA que pour les chauffeurs DISPO (libres + en service,
  // positionnés). Les on-mission / hors-service sont affichés sans ETA.
  // Une seule requête matrice ORS pour tous les dispos → coût quasi nul.
  const isAvailable = (d: any): boolean => {
    if (d.last_location_lat == null || d.last_location_lng == null) return false
    if ((missionsByDriver.get(d.id) || []).length > 0) return false   // en mission → pas dispo
    const locAge = d.location_updated_at ? Math.floor((now - new Date(d.location_updated_at).getTime()) / 1000) : null
    const isFresh = locAge != null && locAge < ACTIVE_WINDOW_MIN * 60
    const onSchedule = (!!d.schedule_day && isInDaySchedule(nowDt)) || (!!d.schedule_night && isInNightSchedule(nowDt))
    return isFresh || onSchedule   // en service
  }
  // ETA calculee uniquement si on a des coords incident ET des chauffeurs dispos.
  // Si incident inconnu OU si ORS echoue, on continue sans ETA (liste complete).
  const available = incident ? drivers.filter(isAvailable) : []
  const etaToIncidentByDriver = new Map<string, number>()
  if (incident && available.length > 0) {
    try {
      const matrixEtas = await getDrivingMatrix(
        available.map((d: any) => ({ lat: Number(d.last_location_lat), lng: Number(d.last_location_lng) })),
        incident,
      )
      available.forEach((d: any, i: number) => { const r = matrixEtas[i]; if (r) etaToIncidentByDriver.set(d.id, truckCapMinutes(r)) })
    } catch (e: any) {
      console.error('[driver-eta] matrice ORS echouee — liste sans ETA:', e?.message || e)
    }
  }

  const enriched = await Promise.all(drivers.map(async (d) => {
    const locAge = d.location_updated_at
      ? Math.floor((now - new Date(d.location_updated_at).getTime()) / 1000)
      : null
    const hasPosition = d.last_location_lat != null && d.last_location_lng != null
    const isFresh     = locAge != null && locAge < ACTIVE_WINDOW_MIN * 60

    const driverMissions = missionsByDriver.get(d.id) || []
    // Représentant pour l'ETA détaillée = la dernière mission assignée (celle que
    // le chauffeur terminera en dernier avant d'être libre).
    const activeMission = driverMissions.length ? driverMissions[driverMissions.length - 1] : null

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

    // Depuis la matrice précalculée (1 requête pour tous), plus 1 appel/chauffeur.
    const etaPositionToIncident: number | null = driverPos ? (etaToIncidentByDriver.get(d.id) ?? null) : null

    let currentMission: any = null
    if (activeMission) {
      // Destination = celle de la mission active si presente, sinon l'incident de cette mission
      const destLat = activeMission.destination_lat ?? activeMission.incident_lat
      const destLng = activeMission.destination_lng ?? activeMission.incident_lng
      const destAddr = activeMission.destination_address || activeMission.incident_address || ''
      const destCoord: Coord | null = destLat != null && destLng != null
        ? { lat: Number(destLat), lng: Number(destLng) }
        : null

      // Chauffeur en mission = pas dispo → on n'appelle PAS Google/ORS pour son ETA
      // (économie). On l'affiche avec sa mission en cours, sans ETA.
      const etaToDestination: number | null = null
      const etaDestinationToIncident: number | null = null

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
      // Toutes les missions actives du chauffeur (pour les noter dans le modal).
      current_missions:         driverMissions.map(mm => ({
        id:                  mm.id,
        dossier_number:      mm.dossier_number,
        mission_type:        mm.mission_type,
        destination_address: mm.destination_address || mm.incident_address || '',
        status:              mm.status,
      })),
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
