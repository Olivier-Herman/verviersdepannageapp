// src/lib/notifications/send.ts
//
// Helper serveur pour envoyer une notification a un user.
//
// 1. Verifie que le type est valide (catalogue figé)
// 2. Verifie la pref user (notification_preferences) — fallback au default si pas de ligne
// 3. Si enabled : INSERT dans notifications_log (Realtime propage au client)
//
// Reutilisable depuis n'importe quelle route serveur (cron, API, processor email).
// Pour les phases ulterieures (push Capacitor N4, auto-call Teams N5), on
// branchera ici les autres channels en plus du in_app.

import { createAdminClient } from '@/lib/supabase'
import { NOTIFICATION_TYPES, isEnabled } from './types'
import { sendPushNotification } from './push'
import { retirerModeChauffeur } from '@/lib/work-mode'

export interface NotificationPayload {
  /** Titre court affiche dans le bandeau */
  title: string
  /** Corps du message */
  body: string
  /** URL a ouvrir au clic (optionnel) */
  action_url?: string
  /** ID mission liee (optionnel, pour click → /dispatch/[id]) */
  mission_id?: string
  /** Donnees custom propres au type (ex: { driverId, eta } pour auto_dispatch_dispo_request) */
  data?: Record<string, any>
}

export interface SendNotificationResult {
  ok:      boolean
  skipped?: 'disabled_by_pref' | 'invalid_type' | 'user_not_found'
  log_id?: string
  error?:  string
}

/**
 * Envoie une notification au user via le canal in_app (insert dans
 * notifications_log → Supabase Realtime → bandeau cote client).
 *
 * @param userId UUID du user destinataire
 * @param type   key du catalogue NOTIFICATION_TYPES
 * @param payload contenu de la notif (title, body, etc.)
 */
// ── Absences (réglage notifs_absences : [{ user_ids, jusqu_au: 'AAAA-MM-JJ', motif }]) ──────────────────────
// Ce qui reste pendant une absence = le dispatch : catégories « dispatch » et « en service », plus les alertes
// d'exploitation rangées ailleurs. Jamais : paiements, congés, courrier, fourrière, questions et annonces.
const DISPATCH_HORS_CATEGORIE = new Set(['touring_cancelled', 'expert_access', 'expert_visit', 'verification_parc', 'message_bloquant', 'kaze_accept_manual', 'kaze_proposal_missing', 'vab_onsite_failed', 'vab_vr_a_cloturer', 'market_claimed', 'kaze_cancelled_after_start'])
const PAS_DISPATCH = new Set(['payment_validated', 'mobia_draft', 'courrier_task', 'levee_saisie_alarme'])
function estDispatch(type: string): boolean {
  if (PAS_DISPATCH.has(type)) return false
  if (DISPATCH_HORS_CATEGORIE.has(type)) return true
  const cat = NOTIFICATION_TYPES.find(t => t.key === type)?.category
  return cat === 'dispatcher' || cat === 'on_duty'
}
async function absentHorsDispatch(sb: ReturnType<typeof createAdminClient>, userId: string, type: string): Promise<boolean> {
  if (estDispatch(type)) return false
  const { data } = await sb.from('app_settings').select('value').eq('key', 'notifs_absences').maybeSingle()
  let liste: any[] = []
  try { liste = JSON.parse(String((data as any)?.value || '[]')) } catch { return false }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())
  return (Array.isArray(liste) ? liste : []).some(a => Array.isArray(a?.user_ids) && a.user_ids.includes(userId) && String(a.jusqu_au || '') >= today)
}

// ── Mode Chauffeur (Olivier 05/11/2026) : plus d'alertes du dispatch, puisqu'un autre l'assure. Ses propres missions et
// les alertes d'administration continuent d'arriver. Les types mixtes vont au bureau ET au chauffeur de la mission.
const ALERTES_DISPATCH_HORS_CATEGORIE = new Set(['expert_access', 'expert_visit', 'verification_parc', 'kaze_accept_manual', 'kaze_proposal_missing', 'vab_onsite_failed', 'vab_vr_a_cloturer', 'escalation_call', 'payment_derogation_requested', 'restitution_derogation_requested', 'driver_amount_set'])
const ALERTES_MIXTES = new Set(['axa_cancelled_after_start', 'mission_address_changed', 'touring_cancelled', 'kaze_cancelled_after_start', 'mission_cancelled_by_insurer'])
async function coupeeEnChauffeur(sb: ReturnType<typeof createAdminClient>, userId: string, type: string, missionId?: string): Promise<boolean> {
  if (PAS_DISPATCH.has(type)) return false
  const t = NOTIFICATION_TYPES.find(x => x.key === type)
  const mixte = ALERTES_MIXTES.has(type)
  if (!mixte && !ALERTES_DISPATCH_HORS_CATEGORIE.has(type) && !(t?.category === 'dispatcher' && !t.applicableRoles.includes('driver'))) return false
  if ((await retirerModeChauffeur([userId])).length) return false
  if (!mixte) return true
  if (!missionId) return false
  const { data } = await sb.from('incoming_missions').select('assigned_to').eq('id', missionId).maybeSingle()
  return (data as any)?.assigned_to !== userId
}

export async function sendNotification(
  userId:  string,
  type:    string,
  payload: NotificationPayload,
): Promise<SendNotificationResult> {
  if (!NOTIFICATION_TYPES.some(t => t.key === type)) {
    console.warn(`[sendNotification] Type inconnu: ${type}`)
    return { ok: false, skipped: 'invalid_type' }
  }

  const sb = createAdminClient()

  // 1. Lookup user (verif existence + role pour applicabilite future)
  const { data: user } = await sb
    .from('users')
    .select('id, role, active')
    .eq('id', userId)
    .maybeSingle()
  if (!user || !user.active) {
    return { ok: false, skipped: 'user_not_found' }
  }

  // 2. Verifie la preference user (avec fallback default du catalogue)
  const { data: prefRow } = await sb
    .from('notification_preferences')
    .select('enabled')
    .eq('user_id', userId)
    .eq('notif_type', type)
    .maybeSingle()
  const prefMap = new Map<string, boolean>()
  if (prefRow && typeof prefRow.enabled === 'boolean') prefMap.set(type, prefRow.enabled)
  if (!isEnabled(type, prefMap)) {
    return { ok: false, skipped: 'disabled_by_pref' }
  }
  // 2 bis. Absence datée (Olivier 01/11/2026 : Momo en vacances jusqu'au 10/11 inclus, Matthieu au PC de Momo) :
  // pendant l'absence, seules les notifications de dispatch passent ; tout revient seul le lendemain de la date.
  if (await absentHorsDispatch(sb, userId, type)) {
    return { ok: false, skipped: 'disabled_by_pref' }
  }

  if (await coupeeEnChauffeur(sb, userId, type, payload.mission_id)) {
    return { ok: false, skipped: 'disabled_by_pref' }
  }

  // 3. INSERT dans le log → Realtime propage au client (canal in_app)
  const { data, error } = await sb
    .from('notifications_log')
    .insert({
      user_id:    userId,
      notif_type: type,
      payload:    payload as any,
      channel:    'in_app',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[sendNotification] INSERT error:', error.message)
    return { ok: false, error: error.message }
  }

  // 4. Push natif — pour reveiller le device si l'app est en background.
  //    Await obligatoire : sinon Vercel tue la lambda apres le return et
  //    le push ne part jamais (fire-and-forget non supporte sur serverless).
  //    Timeout 15s max via push-apns.ts. Echec n'empeche pas la reponse OK
  //    cote API : la notif est deja en DB (canal in_app) → le client la verra
  //    des qu'il ouvre l'app.
  console.log('[sendNotification] calling sendPushNotification for', userId, 'type=', type)
  try {
    const pushRes = await sendPushNotification(userId, {
      title:      payload.title,
      body:       payload.body,
      action_url: payload.action_url,
      mission_id: payload.mission_id,
      notif_type: type,
      data:       payload.data,
    })
    console.log('[sendNotification] push result =', JSON.stringify(pushRes))
    // Web Push (navigateur PC / PWA) en plus du natif : sans ça, un popup
    // bloquant n'atteignait jamais un PC dont l'onglet VD Soft est en
    // arrière-plan (Jona, 2026-09-07). Abonnement = « Activer les
    // notifications » dans Mon Profil.
    let webRes = { sent: 0, failed: 0 }
    try {
      const { sendWebPushToUser } = await import('@/lib/push')
      webRes = await sendWebPushToUser(userId, {
        title: payload.title, body: payload.body, url: payload.action_url || '/', tag: type,
      })
    } catch (e: any) { console.error('[sendNotification] web push error:', e.message) }
    if (!pushRes.no_devices || webRes.sent || webRes.failed) {
      const { error: pushLogErr } = await sb.from('notifications_log').insert({
        user_id:    userId,
        notif_type: type,
        payload:    { ...payload, push_summary: { ...pushRes, web: webRes } } as any,
        channel:    'push',
      })
      if (pushLogErr) console.error('[sendNotification] push log INSERT error:', pushLogErr.message)
    }
  } catch (e: any) {
    console.error('[sendNotification] push error:', e.message, e.stack?.slice(0, 200))
  }

  return { ok: true, log_id: data.id }
}

/**
 * Envoie une notification a plusieurs users en parallele.
 */
export async function sendNotificationToMany(
  userIds: string[],
  type:    string,
  payload: NotificationPayload,
): Promise<{ sent: number; skipped: number; errors: number }> {
  const results = await Promise.all(userIds.map(id => sendNotification(id, type, payload)))
  return {
    sent:    results.filter(r => r.ok).length,
    skipped: results.filter(r => !r.ok && r.skipped).length,
    errors:  results.filter(r => !r.ok && r.error).length,
  }
}

/**
 * Envoie une notification a tous les users d'un role donne.
 * Utile pour broadcast (ex: new_mission_received → tous les dispatchers).
 */
export async function sendNotificationToRole(
  role:    'driver' | 'dispatcher' | 'admin' | 'superadmin',
  type:    string,
  payload: NotificationPayload,
): Promise<{ sent: number; skipped: number; errors: number }> {
  const sb = createAdminClient()
  const { data: users } = await sb
    .from('users')
    .select('id')
    .eq('active', true)
    .eq('role', role)
  if (!users || users.length === 0) return { sent: 0, skipped: 0, errors: 0 }
  return sendNotificationToMany(users.map(u => u.id), type, payload)
}

/**
 * Envoie une notification a tous les users portant l'un des roles donnes.
 * Filtre sur la colonne `role` ET le tableau `roles[]` (sinon on rate ceux qui
 * n'ont le role que dans le tableau — ex. role='driver', roles=['driver','dispatcher']).
 */
export async function sendNotificationToRoles(
  roles:   Array<'driver' | 'dispatcher' | 'admin' | 'superadmin'>,
  type:    string,
  payload: NotificationPayload,
): Promise<{ sent: number; skipped: number; errors: number }> {
  const sb = createAdminClient()
  const inList = roles.map(r => `"${r}"`).join(',')
  const ovList = `{${roles.join(',')}}`
  const { data: users } = await sb
    .from('users')
    .select('id')
    .eq('active', true)
    .or(`role.in.(${inList}),roles.ov.${ovList}`)
  const ids = [...new Set((users || []).map(u => u.id))]
  if (!ids.length) return { sent: 0, skipped: 0, errors: 0 }
  return sendNotificationToMany(ids, type, payload)
}
