// src/lib/notifications/presence.ts
//
// Présence chauffeur pour le filtrage des notifications OPÉRATIONNELLES.
// Un chauffeur HORS LIGNE (congé approuvé, ou hors garde ET sans ping GPS récent
// ET pas en mission) ne doit PAS recevoir les notifs opérationnelles (mission
// assignée/modifiée). Il garde les notifs administratives (validation congé,
// annonces…) qui, elles, partent sans notifType et ne sont donc pas filtrées.
// Même définition « en ligne / hors service » que /api/users/driver-status.
// Olivier 2026-08-09.

import { createAdminClient } from '@/lib/supabase'
import { isInDaySchedule, isInNightSchedule } from '@/lib/schedule'
import { ensureScheduleLoaded }                from '@/lib/schedule-server'

const FRESH_PING_MIN = 30

/** Sous-ensemble des userIds qui sont HORS LIGNE (à exclure des notifs opé). */
export async function getOfflineUserIds(userIds: string[]): Promise<Set<string>> {
  const offline = new Set<string>()
  if (!userIds.length) return offline
  const sb = createAdminClient()
  await ensureScheduleLoaded()
  const now = new Date()
  const todayBxl = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(now)

  const [usersRes, leavesRes, missionsRes] = await Promise.all([
    sb.from('users').select('id, schedule_day, schedule_night, location_updated_at').in('id', userIds),
    sb.from('conge_requests').select('user_id')
      .eq('status', 'approved').lte('start_date', todayBxl).gte('end_date', todayBxl).in('user_id', userIds),
    sb.from('incoming_missions').select('assigned_to')
      .in('status', ['assigned', 'accepted', 'in_progress', 'delivering']).in('assigned_to', userIds),
  ])

  const onLeave = new Set((leavesRes.data || []).map((l: any) => l.user_id))
  const busy    = new Set((missionsRes.data || []).map((m: any) => m.assigned_to))
  const inDay   = isInDaySchedule(now)
  const inNight = isInNightSchedule(now)

  for (const u of (usersRes.data || [])) {
    if (onLeave.has(u.id)) { offline.add(u.id); continue }   // congé = hors ligne, même en garde/ping
    if (busy.has(u.id)) continue                             // en mission = en ligne
    const onSchedule = (!!u.schedule_day && inDay) || (!!u.schedule_night && inNight)
    const age = u.location_updated_at ? (now.getTime() - new Date(u.location_updated_at).getTime()) / 1000 : null
    const freshPing = age != null && age < FRESH_PING_MIN * 60
    if (!onSchedule && !freshPing) offline.add(u.id)
  }
  return offline
}
