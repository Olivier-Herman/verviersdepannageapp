// src/app/api/users/driver-status/route.ts
//
// Retourne le statut de chaque chauffeur (filtre par towsoft_name renseigné) :
//   - en_mission : a au moins une mission active assignée
//   - en_service : forcé par planning de garde (schedule_day/night) ou ping GPS récent (<30min)
//   - hors_service : aucun des deux (chauffeur déconnecté ou hors planning)
// Permet au panel dispatcher d'avoir une vue d'ensemble live.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isInDaySchedule, isInNightSchedule } from '@/lib/schedule'

const FRESH_PING_MIN = 30

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  // Chauffeurs = users actifs avec un towsoft_name (= flag canonique)
  const { data: drivers, error } = await supabase
    .from('users')
    .select('id, name, schedule_day, schedule_night, location_updated_at, last_location_lat, last_location_lng')
    .eq('active', true)
    .not('towsoft_name', 'is', null)
    .neq('towsoft_name', '')
    .order('name')

  if (error) {
    console.error('[DriverStatus] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!drivers || drivers.length === 0) return NextResponse.json({ drivers: [] })

  // Missions actives par chauffeur
  const { data: activeMissions } = await supabase
    .from('incoming_missions')
    .select('id, assigned_to, client_name, mission_type, status')
    .in('status', ['assigned', 'accepted', 'in_progress'])
    .in('assigned_to', drivers.map(d => d.id))

  const STATUS_WEIGHT: Record<string, number> = { in_progress: 3, accepted: 2, assigned: 1 }
  const missionByDriver = new Map<string, NonNullable<typeof activeMissions>[number]>()
  for (const m of activeMissions ?? []) {
    if (!m.assigned_to) continue
    const existing = missionByDriver.get(m.assigned_to)
    if (!existing || (STATUS_WEIGHT[m.status] ?? 0) > (STATUS_WEIGHT[existing.status] ?? 0)) {
      missionByDriver.set(m.assigned_to, m)
    }
  }

  const now = new Date()
  const result = drivers.map(d => {
    const m = missionByDriver.get(d.id)
    if (m) {
      return {
        id:             d.id,
        name:           d.name,
        status:         'en_mission' as const,
        mission_id:     m.id,
        client_name:    m.client_name ?? undefined,
        mission_type:   m.mission_type ?? undefined,
        mission_status: m.status,
        schedule_day:   d.schedule_day,
        schedule_night: d.schedule_night,
        lat:            d.last_location_lat,
        lng:            d.last_location_lng,
      }
    }

    // Pas en mission → on regarde garde/ping
    const inDay   = !!d.schedule_day   && isInDaySchedule(now)
    const inNight = !!d.schedule_night && isInNightSchedule(now)
    const onSchedule = inDay || inNight
    const ageSeconds = d.location_updated_at
      ? Math.floor((now.getTime() - new Date(d.location_updated_at).getTime()) / 1000)
      : null
    const freshPing = ageSeconds != null && ageSeconds < FRESH_PING_MIN * 60

    const status: 'en_service' | 'hors_service' = (onSchedule || freshPing) ? 'en_service' : 'hors_service'

    return {
      id:             d.id,
      name:           d.name,
      status,
      schedule_day:   d.schedule_day,
      schedule_night: d.schedule_night,
      on_schedule:    onSchedule,
      fresh_ping:     freshPing,
      lat:            d.last_location_lat,
      lng:            d.last_location_lng,
    }
  })

  return NextResponse.json({ drivers: result })
}
