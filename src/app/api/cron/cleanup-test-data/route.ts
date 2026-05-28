// Cron horaire (vercel.json) : purge automatique des donnees de test 6h
// apres qu un user a envoye son rapport d evaluation.
//
// Cible : missions dont vehicle_plate ressemble a "TEST" creees pendant la
// fenetre d evaluation du user (7j avant -> 6h apres send-report) ET ou ce
// user est intervenu (mission_logs.actor_id ou user_id).
//
// Olivier 2026-05-28 : "Toutes les taches creee durant les session
// d evaluation, devront etre nettoyee 6h apres que l evaluation soit
// completement terminee".

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

const PURGE_DELAY_HOURS = 6
const WINDOW_BEFORE_DAYS = 7   // fenetre amont (creation des missions test)
const WINDOW_AFTER_HOURS = 6   // fenetre aval (= meme que PURGE_DELAY_HOURS)

interface SessionRow {
  user_id:        string
  report_sent_at: string
}

interface PurgeSummary {
  user_id:           string
  mission_ids:       string[]
  intervention_ids:  string[]
  count:             number
  error?:            string
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const now = Date.now()
  const cutoff = new Date(now - PURGE_DELAY_HOURS * 3600 * 1000).toISOString()

  const { data: sessions, error: sessionsErr } = await sb
    .from('evaluation_sessions')
    .select('user_id, report_sent_at')
    .lt('report_sent_at', cutoff)
    .is('purged_at', null)

  if (sessionsErr) {
    console.error('[cleanup-test-data] Erreur lecture sessions:', sessionsErr.message)
    return NextResponse.json({ error: sessionsErr.message }, { status: 500 })
  }

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ ok: true, purged: 0, sessions: 0 })
  }

  const summaries: PurgeSummary[] = []

  for (const s of sessions as SessionRow[]) {
    const summary = await purgeForSession(sb, s)
    summaries.push(summary)
  }

  const totalPurged = summaries.reduce((acc, s) => acc + s.count, 0)
  console.log(`[cleanup-test-data] ${summaries.length} sessions traitees, ${totalPurged} missions purgees`)

  return NextResponse.json({
    ok:        true,
    sessions:  summaries.length,
    purged:    totalPurged,
    summaries,
  })
}

async function purgeForSession(sb: ReturnType<typeof createAdminClient>, s: SessionRow): Promise<PurgeSummary> {
  const reportTime = new Date(s.report_sent_at).getTime()
  const windowStart = new Date(reportTime - WINDOW_BEFORE_DAYS * 24 * 3600 * 1000).toISOString()
  const windowEnd   = new Date(reportTime + WINDOW_AFTER_HOURS * 3600 * 1000).toISOString()

  // 1) Liste les missions avec plaque TEST dans la fenetre
  const { data: candidates, error: candErr } = await sb
    .from('incoming_missions')
    .select('id, vehicle_plate, created_at, assigned_to')
    .ilike('vehicle_plate', 'TEST%')
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)

  if (candErr) {
    console.error(`[cleanup-test-data] Erreur lecture missions pour user ${s.user_id}:`, candErr.message)
    return { user_id: s.user_id, mission_ids: [], intervention_ids: [], count: 0, error: candErr.message }
  }

  let touchedMissions: string[] = []
  if (candidates && candidates.length > 0) {
    const candidateIds = candidates.map(c => c.id)
    const { data: logs, error: logErr } = await sb
      .from('mission_logs')
      .select('mission_id, actor_id, user_id')
      .in('mission_id', candidateIds)

    if (logErr) {
      console.error(`[cleanup-test-data] Erreur lecture logs pour user ${s.user_id}:`, logErr.message)
      return { user_id: s.user_id, mission_ids: [], intervention_ids: [], count: 0, error: logErr.message }
    }

    const touched = new Set<string>()
    for (const log of logs || []) {
      if (log.actor_id === s.user_id || log.user_id === s.user_id) {
        touched.add(log.mission_id as string)
      }
    }
    // Fallback : missions assignees a ce user (driver-create utilise assigned_to)
    for (const c of candidates) {
      if (c.assigned_to === s.user_id) touched.add(c.id as string)
    }
    touchedMissions = Array.from(touched)
  }

  // 3) Supprime les enfants explicitement pour eviter les soucis de FK.
  //    mission_remarks CASCADE deja, mais mission_logs FK comportement inconnu
  //    sur certaines anciennes tables : on prefere etre explicite.
  if (touchedMissions.length > 0) {
    await sb.from('mission_logs').delete().in('mission_id', touchedMissions)
    const { error: delErr } = await sb
      .from('incoming_missions')
      .delete()
      .in('id', touchedMissions)
    if (delErr) {
      console.error(`[cleanup-test-data] Erreur DELETE missions pour user ${s.user_id}:`, delErr.message)
      return { user_id: s.user_id, mission_ids: [], intervention_ids: [], count: 0, error: delErr.message }
    }
  }

  // 4) Supprime les interventions (encaissements) de test de ce user dans la
  //    fenetre. La table interventions a sa propre colonne plate + user_id.
  const { data: interventions, error: intErr } = await sb
    .from('interventions')
    .select('id')
    .ilike('plate', 'TEST%')
    .eq('user_id', s.user_id)
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)

  let intervIds: string[] = []
  if (intErr) {
    console.error(`[cleanup-test-data] Erreur lecture interventions pour user ${s.user_id}:`, intErr.message)
  } else if (interventions && interventions.length > 0) {
    intervIds = interventions.map(i => i.id as string)
    const { error: delIntErr } = await sb.from('interventions').delete().in('id', intervIds)
    if (delIntErr) {
      console.error(`[cleanup-test-data] Erreur DELETE interventions pour user ${s.user_id}:`, delIntErr.message)
    }
  }

  await markPurged(sb, s.user_id, touchedMissions, intervIds)
  return {
    user_id:          s.user_id,
    mission_ids:      touchedMissions,
    intervention_ids: intervIds,
    count:            touchedMissions.length + intervIds.length,
  }
}

async function markPurged(
  sb: ReturnType<typeof createAdminClient>,
  userId: string,
  missionIds: string[],
  interventionIds: string[],
) {
  const now = new Date().toISOString()
  await sb
    .from('evaluation_sessions')
    .update({
      purged_at:     now,
      purge_summary: {
        mission_ids:      missionIds,
        intervention_ids: interventionIds,
        count:            missionIds.length + interventionIds.length,
        purged_at:        now,
      },
      updated_at:    now,
    })
    .eq('user_id', userId)
}
