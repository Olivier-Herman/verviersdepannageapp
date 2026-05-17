// src/app/api/watch/missions/today/route.ts
//
// GET /api/watch/missions/today
// Auth : Authorization: Bearer <watch-jwt>
//
// Payload allege pour la Watch (ecran 41-49mm, batterie limitee). On retourne
// uniquement les champs utiles a l affichage liste + action immediate.
//
// - Pour un chauffeur : ses missions du jour (assigned, accepted, in_progress,
//   delivering, parked) — pas les terminees ni les "new"/"dispatching".
// - Pour un dispatcher : compteur de missions en attente + 5 plus urgentes.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyWatchAuth }   from '@/lib/auth-watch'

export const dynamic = 'force-dynamic'

const DRIVER_STATUSES = ['assigned', 'accepted', 'in_progress', 'delivering', 'parked']
const URGENT_STATUSES = ['new', 'dispatching']

interface WatchMissionLite {
  id:                 string
  external_id:        string | null
  status:             string
  mission_type:       string | null
  source:             string | null
  client_name:        string | null
  vehicle_plate:      string | null
  vehicle_brand:      string | null
  vehicle_model:      string | null
  incident_city:      string | null
  incident_address:   string | null
  destination_address: string | null
  amount_to_collect:  number | null
  payment_collected_at: string | null
  received_at:        string | null
  intervention_date:  string | null
}

const MISSION_FIELDS = [
  'id', 'external_id', 'status', 'mission_type', 'source',
  'client_name', 'vehicle_plate', 'vehicle_brand', 'vehicle_model',
  'incident_city', 'incident_address', 'destination_address',
  'amount_to_collect', 'payment_collected_at',
  'received_at', 'intervention_date',
].join(',')

export async function GET(req: Request) {
  const userId = await verifyWatchAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  const { data: user } = await sb
    .from('users')
    .select('id, role, roles')
    .eq('id', userId)
    .single()
  if (!user) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  const rawRoles = Array.isArray(user.roles) ? user.roles as string[] : [user.role].filter(Boolean) as string[]
  const normalizedRoles = rawRoles.map(r => String(r ?? '').trim().toLowerCase())
  // superadmin = super-role qui implique tous les autres (dispatcher + driver)
  const isSuperadmin = normalizedRoles.includes('superadmin')
  const isDispatcher = isSuperadmin || normalizedRoles.some(r => r === 'dispatcher' || r === 'admin')
  const isDriver     = isSuperadmin || normalizedRoles.includes('chauffeur') || normalizedRoles.includes('driver')

  // Driver : missions du jour assignees a moi
  let driver_missions: WatchMissionLite[] = []
  if (isDriver) {
    // DEBUG: isoler le bug q2 (3 rows) vs q3 (1 row)
    const q2 = await sb.from('incoming_missions').select('id, status').eq('assigned_to', userId).in('status', DRIVER_STATUSES)
    const q4_select = await sb.from('incoming_missions').select(MISSION_FIELDS).eq('assigned_to', userId).in('status', DRIVER_STATUSES)
    const q5_order = await sb.from('incoming_missions').select('id, status').eq('assigned_to', userId).in('status', DRIVER_STATUSES).order('intervention_date', { ascending: true, nullsFirst: false })
    const q3_full = await sb.from('incoming_missions').select(MISSION_FIELDS).eq('assigned_to', userId).in('status', DRIVER_STATUSES).order('intervention_date', { ascending: true, nullsFirst: false }).limit(50)
    console.log('[watch/today] q2 simple:', q2.data?.length)
    console.log('[watch/today] q4 with MISSION_FIELDS only:', q4_select.data?.length, 'err=', q4_select.error)
    console.log('[watch/today] q5 with order only:', q5_order.data?.length, 'err=', q5_order.error)
    console.log('[watch/today] q3 full:', q3_full.data?.length, 'err=', q3_full.error)
    driver_missions = ((q3_full.data || []) as unknown) as WatchMissionLite[]
  }

  // Dispatcher : compteur + 5 missions en attente les plus urgentes
  let dispatcher_pending_count = 0
  let dispatcher_top: WatchMissionLite[] = []
  if (isDispatcher) {
    const { count } = await sb
      .from('incoming_missions')
      .select('id', { count: 'exact', head: true })
      .in('status', URGENT_STATUSES)
    dispatcher_pending_count = count || 0

    const { data } = await sb
      .from('incoming_missions')
      .select(MISSION_FIELDS)
      .in('status', URGENT_STATUSES)
      .order('received_at', { ascending: true, nullsFirst: false })
      .limit(5)
    dispatcher_top = ((data || []) as unknown) as WatchMissionLite[]
  }

  return NextResponse.json({
    ok: true,
    role: isDispatcher ? 'dispatcher' : 'driver',  // legacy, encore lu pour fallback
    is_driver: isDriver,
    is_dispatcher: isDispatcher,
    driver_missions,
    dispatcher_pending_count,
    dispatcher_top,
    server_time: new Date().toISOString(),
  })
}
