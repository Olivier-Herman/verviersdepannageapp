// src/lib/watch/perform-action.ts
//
// Coeur des actions chauffeur depuis l Apple Watch. Limite aux 4 actions
// "simples" : accept, refuse, on_way, on_site. Pour completer une mission
// (encaissement, photos, signature), le chauffeur sort l iPhone.
//
// Cette factorisation permet de l appeler depuis :
//   - POST /api/watch/missions/[id]/action  (action unitaire en ligne)
//   - POST /api/watch/queued-actions        (batch flush apres reconnexion)

import { createAdminClient } from '@/lib/supabase'

export type WatchAction = 'accept' | 'refuse' | 'on_way' | 'on_site'

export interface WatchActionResult {
  ok:      boolean
  status?: number
  error?:  string
  mission?: any
}

const ALLOWED_FROM: Record<WatchAction, string[]> = {
  accept:  ['assigned'],
  refuse:  ['assigned'],   // refus uniquement avant accept. Apres accept, contacter dispatcher.
  on_way:  ['accepted'],
  on_site: ['in_progress'],
}

const LOG_MESSAGE: Record<WatchAction, string> = {
  accept:  'Mission acceptee depuis Apple Watch',
  refuse:  'Mission refusee depuis Apple Watch',
  on_way:  'Chauffeur en route (Apple Watch)',
  on_site: 'Chauffeur sur place (Apple Watch)',
}

/**
 * Execute une action Watch sur une mission, avec verification droits + statut.
 * Idempotent : si la mission est deja dans le statut cible, retourne ok:true noop.
 */
export async function performWatchAction(
  userId:    string,
  missionId: string,
  action:    WatchAction,
): Promise<WatchActionResult> {
  const sb = createAdminClient()

  const { data: mission, error: fetchErr } = await sb
    .from('incoming_missions')
    .select('id, status, assigned_to')
    .eq('id', missionId)
    .single()
  if (fetchErr || !mission) return { ok: false, status: 404, error: 'Mission introuvable' }

  if (mission.assigned_to !== userId) {
    return { ok: false, status: 403, error: 'Acces refuse' }
  }

  const allowed = ALLOWED_FROM[action]
  if (!allowed.includes(mission.status)) {
    // Idempotence : si on est deja dans le statut cible, on considere noop OK.
    const targetStatus = action === 'accept' ? 'accepted'
                       : action === 'on_way' ? 'in_progress'
                       : action === 'on_site' ? 'in_progress'
                       : null
    if (targetStatus && mission.status === targetStatus) {
      return { ok: true, mission, status: 200 }
    }
    return { ok: false, status: 422, error: `Action '${action}' non permise depuis '${mission.status}'` }
  }

  const now = new Date().toISOString()
  const updatePayload: Record<string, unknown> = { updated_at: now }

  if (action === 'accept') {
    updatePayload.status      = 'accepted'
    updatePayload.accepted_at = now
  } else if (action === 'refuse') {
    updatePayload.status      = 'dispatching'
    updatePayload.assigned_to = null
    updatePayload.assigned_at = null
    updatePayload.accepted_at = null
  } else if (action === 'on_way') {
    updatePayload.status   = 'in_progress'
    updatePayload.on_way_at = now
  } else if (action === 'on_site') {
    updatePayload.on_site_at = now
  }

  const { data: updated, error: updateErr } = await sb
    .from('incoming_missions')
    .update(updatePayload)
    .eq('id', missionId)
    .select()
    .single()
  if (updateErr) {
    console.error('[watch/action] update error:', updateErr.message)
    return { ok: false, status: 500, error: 'Erreur mise a jour' }
  }

  await sb.from('mission_logs').insert({
    mission_id: missionId,
    actor_id:   userId,
    action,
    notes:      LOG_MESSAGE[action],
    metadata:   { action, status: updated.status, source: 'watch' },
  })

  return { ok: true, mission: updated, status: 200 }
}
