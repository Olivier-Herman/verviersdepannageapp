// src/app/api/cron/auto-dispatch-tick/route.ts
//
// Cron toutes les 60s : fait evoluer le flow auto-dispatch.
//
// Pour chaque attempt actif (push_sent / call_1_sent / call_2_sent) :
//   - push_sent + 60s → trigger call_1 (Teams Phone)
//   - call_1_sent + 60s → trigger call_2
//   - call_2_sent + 60s → SKIP + passe au suivant
//
// NB: pour C2+ (attempt_order >= 2), startAttempt envoie push + call_1
// directement, donc le cron ne fait que call_2 → skip pour ces cas.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { initiatePstnCall }  from '@/lib/teams/call'
import { skipToNext }        from '@/lib/auto-dispatch/orchestrator'
import { isInDaySchedule, isInNightSchedule } from '@/lib/schedule'
import { ensureScheduleLoaded }                from '@/lib/schedule-server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const TIMEOUT_SEC = 60  // delai d'attente entre push → call_1 → call_2 → skip

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  await ensureScheduleLoaded()

  const sb = createAdminClient()
  const now = Date.now()
  const cutoff = new Date(now - TIMEOUT_SEC * 1000).toISOString()

  // Recupere tous les attempts dont l'evenement courant date de > 60s
  const { data: attempts } = await sb
    .from('dispatch_attempts_log')
    .select('id, mission_id, driver_id, attempt_order, status, push_sent_at, call_1_at, call_2_at, driver:users!dispatch_attempts_log_driver_id_fkey(name, phone)')
    .in('status', ['push_sent', 'call_1_sent', 'call_2_sent'])
    .lte('updated_at', cutoff)

  if (!attempts || attempts.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 })
  }

  let actions = 0
  for (const a of attempts) {
    const driverName  = (a.driver as any)?.name || ''
    const driverPhone = (a.driver as any)?.phone as string | null

    if (a.status === 'push_sent') {
      // Push pas repondu → trigger call_1 (sauf pour C2+ ou call_1 est deja envoye)
      if (a.attempt_order === 1 && driverPhone) {
        const r = await initiatePstnCall({ toPhone: driverPhone, toDisplayName: driverName })
        await sb.from('dispatch_attempts_log').update({
          status:    r.ok ? 'call_1_sent' : a.status,
          call_1_at: r.ok ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq('id', a.id)
        if (r.ok) actions++
      }
      continue
    }

    if (a.status === 'call_1_sent') {
      // Call 1 pas valide → trigger call_2
      if (driverPhone) {
        const r = await initiatePstnCall({ toPhone: driverPhone, toDisplayName: driverName })
        await sb.from('dispatch_attempts_log').update({
          status:    r.ok ? 'call_2_sent' : a.status,
          call_2_at: r.ok ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq('id', a.id)
        if (r.ok) actions++
      }
      continue
    }

    if (a.status === 'call_2_sent') {
      // Call 2 pas valide → skip + passe au suivant
      // On a besoin de re-deriver la liste candidates (sans le current ni les essayes)
      const { data: mission } = await sb
        .from('incoming_missions')
        .select('id, dossier_number, incident_city')
        .eq('id', a.mission_id)
        .single()
      const missionLabel = `Mission ${mission?.dossier_number || a.mission_id.slice(0, 8)}${mission?.incident_city ? ' — ' + mission.incident_city : ''}`

      // Liste tous candidates via API (interne cron)
      const baseUrl = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
      // NB: ici on n'a pas de session user — on appelle driver-eta directement en SQL
      // (ou via une variante interne). Pour simplifier, on lookup les drivers actifs
      // qui ne sont pas dans la liste deja essayee.
      const { data: tried } = await sb
        .from('dispatch_attempts_log')
        .select('driver_id')
        .eq('mission_id', a.mission_id)
      const triedIds = new Set((tried || []).map(t => t.driver_id))

      // NB: Supabase .not('id', 'in', ...) buggue avec UUIDs entre quotes simples
      // → on fetch tous et on filtre cote client (plus fiable)
      const { data: allCandidates } = await sb
        .from('users')
        .select('id, name, phone, priority_order, schedule_day, schedule_night, location_updated_at')
        .eq('active', true)
        .or('role.in.(driver,admin,superadmin),roles.ov.{driver,admin,superadmin}')
        .order('priority_order', { ascending: true, nullsFirst: false })
        .order('name')

      // Filtre "de garde" : meme logique que /api/missions/[id]/driver-eta
      // (planning de garde actif OU ping GPS recent < 30 min). Sans ca le cron
      // pioche dans tous les chauffeurs actifs et peut tomber sur un hors-service.
      const FRESH_PING_SEC = 30 * 60
      const nowDt = new Date()
      const inDay   = isInDaySchedule(nowDt)
      const inNight = isInNightSchedule(nowDt)
      const onDutyCandidates = (allCandidates || []).filter(c => {
        if (triedIds.has(c.id)) return false
        const onSchedule = (!!c.schedule_day && inDay) || (!!c.schedule_night && inNight)
        const ageSec = c.location_updated_at
          ? Math.floor((nowDt.getTime() - new Date(c.location_updated_at).getTime()) / 1000)
          : null
        const freshPing = ageSec != null && ageSec < FRESH_PING_SEC
        return onSchedule || freshPing
      })
      const candidates = onDutyCandidates

      const nextDrivers = candidates.map(c => ({
        id:          c.id,
        name:        c.name,
        phone:       c.phone as string | null,
        isInMission: false,  // on ne sait pas ici, default false (a affiner)
      }))

      const r = await skipToNext({
        attemptId:    a.id,
        missionId:    a.mission_id,
        reason:       'timeout',
        nextDrivers,
        missionLabel,
      })
      if (r.ok || r.escalated) actions++
      continue
    }
  }

  return NextResponse.json({ ok: true, processed: attempts.length, actions })
}
