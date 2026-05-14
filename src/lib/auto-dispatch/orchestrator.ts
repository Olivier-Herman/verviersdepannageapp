// src/lib/auto-dispatch/orchestrator.ts
//
// Orchestrateur du flow auto-dispatch sequentiel.
//
// Le serverless Vercel ne peut pas await 60s en blocant, donc le flow est
// piloté par un cron Vercel (/api/cron/auto-dispatch-tick toutes les min)
// qui lit dispatch_attempts_log et fait evoluer les statuts.
//
// Flow par chauffeur (cf project_auto_dispatch_scenario.md) :
//   C1 :   push → 60s → call_1 → 60s → call_2 → 60s → SKIP
//   C2+ :  push + call_1 simultanes → 60s → call_2 → 60s → SKIP
//
// "Pas dispo" via notif → skip immediat au suivant.
// Si tous epuises → call Teams au DISPATCHER_GARDE_PHONE.

import { createAdminClient }    from '@/lib/supabase'
import { sendNotification }     from '@/lib/notifications/send'
import { initiatePstnCall }     from '@/lib/teams/call'

/**
 * Initie la tentative pour un chauffeur (cree la row + envoie push + call si C2+).
 * Appelle par : trigger initial (C1) ou cron (passage au suivant).
 */
export async function startAttempt(params: {
  missionId:     string
  driverId:      string
  attemptOrder:  number
  driverPhone:   string | null
  driverName:    string
  isInMission:   boolean
  triggeredBy?:  string | null
  missionLabel:  string  // affiche dans la notif/call (ex: "Mission 8293644 - Lanaken")
}): Promise<{ ok: boolean; attemptId?: string; error?: string }> {
  const sb = createAdminClient()
  const now = new Date().toISOString()

  const { data: attempt, error } = await sb
    .from('dispatch_attempts_log')
    .insert({
      mission_id:    params.missionId,
      driver_id:     params.driverId,
      attempt_order: params.attemptOrder,
      status:        'pending',
      triggered_by:  params.triggeredBy || null,
      created_at:    now,
      updated_at:    now,
    })
    .select('id')
    .single()
  if (error || !attempt) return { ok: false, error: error?.message }

  // 1. Push notif
  const notifType = params.isInMission ? 'auto_dispatch_dispo_request' : 'auto_dispatch_dispo_request'
  await sendNotification(params.driverId, notifType, {
    title:      'Nouvelle mission proposée',
    body:       params.missionLabel + (params.isInMission ? ' — Dispo dans combien de temps ?' : ''),
    mission_id: params.missionId,
    action_url: `/mission/auto-dispatch/${attempt.id}`,
    data:       { attempt_id: attempt.id, is_in_mission: params.isInMission },
  })

  await sb.from('dispatch_attempts_log').update({
    status:        'push_sent',
    push_sent_at:  now,
    updated_at:    now,
  }).eq('id', attempt.id)

  // 2. Si C2+ → call immediat en parallele du push (les chauffeurs dorment la nuit)
  if (params.attemptOrder >= 2 && params.driverPhone) {
    const callRes = await initiatePstnCall({
      toPhone:       params.driverPhone,
      toDisplayName: params.driverName,
    })
    await sb.from('dispatch_attempts_log').update({
      status:    callRes.ok ? 'call_1_sent' : 'push_sent',  // si call fail, on reste sur push_sent
      call_1_at: callRes.ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', attempt.id)
  }

  return { ok: true, attemptId: attempt.id }
}

/**
 * Marque l'attempt courant comme skipped + envoie notif info au dispatcher
 * de garde (pour reveil) + initie l'attempt pour le chauffeur suivant.
 * Si plus de chauffeurs → escalade dispatcher de garde (call PSTN).
 */
export async function skipToNext(params: {
  attemptId:   string
  missionId:   string
  reason:      'timeout' | 'refused' | 'unavailable'
  nextDrivers: Array<{ id: string; name: string; phone: string | null; isInMission: boolean }>
  missionLabel: string
}): Promise<{ ok: boolean; nextAttemptId?: string; escalated?: boolean; error?: string }> {
  const sb = createAdminClient()
  const now = new Date().toISOString()

  // 1. Mark current attempt as skipped
  await sb.from('dispatch_attempts_log').update({
    status: params.reason === 'timeout' ? 'timeout' : (params.reason === 'unavailable' ? 'unavailable' : 'refused'),
    updated_at: now,
  }).eq('id', params.attemptId)

  // 2. Recupere l'ordre courant pour incrementer
  const { data: current } = await sb
    .from('dispatch_attempts_log')
    .select('attempt_order, driver_id')
    .eq('id', params.attemptId)
    .single()
  if (!current) return { ok: false, error: 'attempt not found' }

  const nextOrder = current.attempt_order + 1

  // 3. Notif info au dispatch de garde (pour reveil)
  await sendNotificationToOnDutyDispatcher({
    missionId:    params.missionId,
    skippedName:  '',  // resolve later if needed
    reason:       params.reason,
  })

  // 4. Suivant ou escalade ?
  const next = params.nextDrivers[0]
  if (!next) {
    // Plus de chauffeurs → escalade dispatcher de garde
    return await escalateToDispatcherOnDuty(params.missionId, params.missionLabel)
  }

  // 5. Lance le suivant (C2+ → push + call simultanes)
  const startRes = await startAttempt({
    missionId:    params.missionId,
    driverId:     next.id,
    attemptOrder: nextOrder,
    driverPhone:  next.phone,
    driverName:   next.name,
    isInMission:  next.isInMission,
    missionLabel: params.missionLabel,
  })
  return { ok: true, nextAttemptId: startRes.attemptId }
}

/** Envoie une notif au dispatcher de garde actuel (pas un call). */
async function sendNotificationToOnDutyDispatcher(params: {
  missionId:   string
  skippedName: string
  reason:      string
}): Promise<void> {
  const sb = createAdminClient()
  const { data } = await sb.from('dispatcher_on_duty').select('user_id').eq('id', 1).maybeSingle()
  const userId = data?.user_id
  if (!userId) return  // pas de dispatcher de garde configure

  await sendNotification(userId, 'auto_dispatch_refused', {
    title: `Auto-dispatch — chauffeur skippé`,
    body:  `Raison: ${params.reason}. Mission en cours d'attribution.`,
    mission_id: params.missionId,
    action_url: `/dispatch/${params.missionId}`,
  })
}

/** Liste epuisee → call Teams au numero d'escalade (DISPATCHER_GARDE_PHONE). */
async function escalateToDispatcherOnDuty(missionId: string, missionLabel: string): Promise<{ ok: boolean; escalated: true; error?: string }> {
  const sb = createAdminClient()
  const escalationPhone = process.env.DISPATCHER_GARDE_PHONE || '+3287600615'

  // Notif app au dispatcher de garde (en plus du call)
  const { data } = await sb.from('dispatcher_on_duty').select('user_id').eq('id', 1).maybeSingle()
  if (data?.user_id) {
    await sendNotification(data.user_id, 'escalation_call', {
      title: `🚨 Escalade auto-dispatch — ${missionLabel}`,
      body:  'Aucun chauffeur disponible. Appel en cours.',
      mission_id: missionId,
      action_url: `/dispatch/${missionId}`,
    })
  }

  // Call PSTN vers numero fixe
  const callRes = await initiatePstnCall({
    toPhone:       escalationPhone,
    toDisplayName: 'Escalade Verviers Dispatch',
  })

  // Mark mission as needing manual attention
  await sb.from('incoming_missions').update({
    status: 'new',  // back to new for manual dispatch
    updated_at: new Date().toISOString(),
  }).eq('id', missionId)

  return { ok: callRes.ok, escalated: true, error: callRes.error }
}
