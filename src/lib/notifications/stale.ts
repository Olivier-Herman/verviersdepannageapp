// src/lib/notifications/stale.ts
//
// Notifications de mission devenues sans objet (Olivier 04/10/2026) : une fois
// que le chauffeur a fait l'action dans l'app, la notif ne doit plus rester à
// l'écran du téléphone ni dans l'app.
//   - « À accepter » (attribution, rappel, demande de dispo) : sans objet dès
//     que la mission est acceptée (ou a quitté l'attente d'acceptation).
//   - Toute notif de mission : sans objet quand la mission est clôturée côté
//     chauffeur, annulée, ou n'est plus attribuée à ce chauffeur.

import { createAdminClient } from '@/lib/supabase'

export const ACCEPT_NOTIF_TYPES = ['mission_assigned_manual', 'auto_dispatch_dispo_request', 'new_mission_received']
const FINISHED_STATUSES = ['to_invoice', 'completed', 'cancelled', 'ignored']

const OPEN_ATTEMPT = ['new', 'pending', 'push_sent', 'call_1_sent', 'call_2_sent']

/**
 * Identifiant de regroupement : les rappels « À accepter » d'une même mission
 * se remplacent sur l'écran du téléphone au lieu de s'empiler (Olivier 04/10/2026).
 */
export function pushGroupId(notifType?: string | null, missionId?: string | null): string | null {
  if (!notifType || !missionId || !ACCEPT_NOTIF_TYPES.includes(notifType)) return null
  return `acc-${missionId}`
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Id de mission d'une notif : champ mission_id, sinon lien /mission/<id> ou /dispatch/<id>. */
export function missionIdOf(n: { mission_id?: string | null; action_url?: string | null }): string | null {
  if (n.mission_id && UUID.test(n.mission_id)) return n.mission_id
  const m = (n.action_url || '').match(/\/(?:mission|dispatch)\/([0-9a-f-]{36})/i)
  return m ? m[1] : null
}

export interface NotifRef { key: string; mission_id?: string | null; action_url?: string | null; notif_type?: string | null; attempt_id?: string | null }

/** Clés des notifs sans objet pour ce chauffeur. */
export async function staleNotifKeys(userId: string, items: NotifRef[]): Promise<string[]> {
  const withMission = items.map(n => ({ ...n, mid: missionIdOf(n) })).filter(n => n.mid)
  if (!withMission.length) return []
  const mids = [...new Set(withMission.map(n => n.mid as string))]
  const { data } = await createAdminClient()
    .from('incoming_missions').select('id, status, assigned_to, accepted_at').in('id', mids)
  const byId = new Map((data || []).map((m: any) => [m.id, m]))
  // Demande de dispo (auto-dispatch) : le chauffeur n'est pas encore attribué ;
  // sans objet dès qu'il a répondu, que la demande a expiré ou qu'un autre a la mission.
  const attemptIds = [...new Set(withMission.filter(n => n.notif_type === 'auto_dispatch_dispo_request' && n.attempt_id).map(n => n.attempt_id as string))]
  const attempts = new Map<string, string>()
  if (attemptIds.length) {
    const { data: at } = await createAdminClient().from('dispatch_attempts_log').select('id, status').in('id', attemptIds)
    for (const a of at || []) attempts.set(a.id, a.status)
  }
  return withMission.filter(n => {
    const m: any = byId.get(n.mid)
    if (!m) return false                      // mission introuvable : on ne touche à rien
    if (n.notif_type === 'auto_dispatch_dispo_request') {
      if (FINISHED_STATUSES.includes(m.status)) return true
      if (m.assigned_to && m.assigned_to !== userId) return true
      const st = n.attempt_id ? attempts.get(n.attempt_id) : undefined
      return !!st && !OPEN_ATTEMPT.includes(st)
    }
    if (m.assigned_to !== userId) return true // retirée à ce chauffeur
    if (FINISHED_STATUSES.includes(m.status)) return true
    if (n.notif_type && ACCEPT_NOTIF_TYPES.includes(n.notif_type)) return !(m.status === 'assigned' && !m.accepted_at)
    return false
  }).map(n => n.key)
}
