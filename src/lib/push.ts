// src/lib/push.ts
// Helper pour envoyer des notifications push.
// Couvre 2 canaux distincts pour qu un user recoive la notif quel que soit
// son installation :
//   1. Web Push (VAPID) -> push_subscriptions (users PWA Safari/Chrome)
//   2. APNs / FCM       -> device_tokens (users iOS/Android via Capacitor)
//
// sendPushToUser / sendPushToRole envoient sur les DEUX canaux pour chaque
// destinataire, garantissant la livraison peu importe le device.

import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase'
import { sendPushNotification } from './notifications/push'

// Configuration VAPID
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export interface PushPayload {
  title:   string
  body:    string
  icon?:   string
  badge?:  string
  url?:    string
  tag?:    string  // permet de remplacer une notif existante du même tag
}

/** Categorie de notif pour respecter les preferences user. Cf migration
 *  202605181900 sur users.notif_preferences. Si non passe, la notif est
 *  envoyee a tous sans filtre. */
export type NotifType =
  | 'dispatch_new_mission'
  | 'driver_assigned'
  | 'driver_modified'
  | 'cash_transfer'
  | 'derogation_request'
  | 'alert_admin'

/** Mapping NotifType → role_key dans notif_preferences.
 *  Olivier 2026-06-02 : refacto vers toggles par role (au lieu de toggles
 *  individuels par categorie). Un user multi-roles (ex: Matthieu driver +
 *  dispatcher) coupe d un coup toutes les notifs d un role quand il bosse
 *  dans l autre.
 *
 *  cash_transfer : NON mappe — Olivier a decide que les notifs finance sont
 *  essentielles et ne peuvent pas etre desactivees par le user.
 */
const NOTIF_TYPE_TO_ROLE_KEY: Partial<Record<NotifType, 'role_driver' | 'role_dispatcher'>> = {
  driver_assigned:      'role_driver',
  driver_modified:      'role_driver',
  dispatch_new_mission: 'role_dispatcher',
  derogation_request:   'role_dispatcher',
  alert_admin:          'role_dispatcher',
  // cash_transfer : intentionnellement non-mappe → toujours envoyee
}

// Notifs OPÉRATIONNELLES : jamais envoyées à un user HORS LIGNE. « On base le ok
// notif sur le statut » (Olivier 2026-08-09) : le statut effectif (manuel /
// congé / garde+ping) est calculé par getOfflineUserIds, qui traite déjà les
// non-chauffeurs (dispatchers) comme EN LIGNE par défaut → hors ligne seulement
// via le toggle manuel ou un congé. On peut donc gater aussi les types
// dispatcher. Les notifs administratives (validation congé, annonces…) partent
// SANS notifType et ne sont donc jamais filtrées ici. cash_transfer/alert_admin
// restent essentielles (toujours envoyées).
const OFFLINE_GATED_NOTIF_TYPES = new Set<NotifType>([
  'driver_assigned', 'driver_modified', 'dispatch_new_mission', 'derogation_request',
])

/**
 * Filtre une liste d'user_ids selon les preferences notif_preferences.
 * Defaut on = retro-compat. Si la clef role est explicitement false, on bloque.
 * Lit aussi l ancienne clef per-categorie (driver_assigned, etc.) pour
 * retro-compat avec les users qui ont deja sauvegarde avant ce refacto.
 */
async function filterByNotifPref(userIds: string[], notifType?: NotifType): Promise<string[]> {
  if (!notifType || userIds.length === 0) return userIds
  let ids = userIds

  // 1) Préférences par role (toggle profil). cash_transfer (non mappe) ne peut
  //    pas etre bloque par l user (notif essentielle).
  const roleKey = NOTIF_TYPE_TO_ROLE_KEY[notifType]
  if (roleKey) {
    const sb = createAdminClient()
    const { data } = await sb.from('users').select('id, notif_preferences').in('id', ids)
    if (data) {
      ids = data
        .filter(u => {
          const pref = (u.notif_preferences || {}) as Record<string, unknown>
          if (pref[roleKey] === false) return false        // nouveau systeme (par role)
          if (pref[notifType] === false) return false       // retro-compat (par categorie)
          return true
        })
        .map(u => u.id)
    }
  }

  // 2) Notifs opérationnelles chauffeur → exclure les chauffeurs HORS LIGNE
  //    (congé / hors garde sans ping / pas en mission). Les admin/annonces
  //    passent sans notifType et ne sont donc jamais filtrées ici.
  if (OFFLINE_GATED_NOTIF_TYPES.has(notifType) && ids.length) {
    const { getOfflineUserIds } = await import('@/lib/notifications/presence')
    const offline = await getOfflineUserIds(ids)
    if (offline.size) ids = ids.filter(id => !offline.has(id))
  }

  return ids
}

/**
 * Envoie une notification push à un utilisateur spécifique sur TOUS ses canaux :
 *   - Web Push (PWA Safari/Chrome) via push_subscriptions
 *   - APNs/FCM (Capacitor iOS/Android + Apple Watch) via device_tokens
 * Supprime automatiquement les abonnements Web Push révoqués (410/404).
 *
 * Si `notifType` est passe et que l user a desactive cette categorie dans
 * ses notif_preferences, on no-op silencieusement.
 */
export async function sendPushToUser(
  userId:    string,
  payload:   PushPayload,
  notifType?: NotifType,
): Promise<{ sent: number; failed: number }> {
  if (notifType) {
    const allowed = await filterByNotifPref([userId], notifType)
    if (allowed.length === 0) return { sent: 0, failed: 0 }
  }
  const supabase = createAdminClient()

  let sent = 0, failed = 0

  // 1. Web Push (PWA)
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)

  for (const sub of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          title:  payload.title,
          body:   payload.body,
          icon:   payload.icon  ?? '/icons/apple-touch-icon.png',
          badge:  payload.badge ?? '/icons/apple-touch-icon.png',
          url:    payload.url   ?? '/',
          tag:    payload.tag,
        })
      )
      sent++
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        console.log(`[Push] Web Push révoqué supprimé: ${sub.id}`)
      } else {
        console.error(`[Push] Web Push erreur ${sub.id}:`, err.message)
      }
      failed++
    }
  }

  // 2. APNs/FCM (Capacitor) — meme payload converti
  try {
    const native = await sendPushNotification(userId, {
      title:      payload.title,
      body:       payload.body,
      action_url: payload.url,
      notif_type: payload.tag || 'generic',
    })
    sent   += native.sent
    failed += native.failed
  } catch (e: any) {
    console.error('[Push] APNs/FCM dispatch error:', e.message)
  }

  return { sent, failed }
}

/**
 * Envoie une notification push à plusieurs utilisateurs.
 */
export async function sendPushToUsers(
  userIds:   string[],
  payload:   PushPayload,
  notifType?: NotifType,
): Promise<void> {
  const filtered = notifType ? await filterByNotifPref(userIds, notifType) : userIds
  await Promise.allSettled(filtered.map(id => sendPushToUser(id, payload)))
}

/**
 * Anti-spam : si le `tag` du push a deja ete utilise dans la fenetre TTL
 * (defaut 60s), on skip silencieusement. Mecanisme defensif post-incident
 * Olivier 2026-05-26 (burst 10 push identiques en 30s).
 *
 * Implementation atomique sans RPC :
 *   1. SELECT sent_at WHERE tag=X
 *   2. Si row recente (< TTL) -> skip
 *   3. Sinon : UPSERT (insert si absent, update sent_at sinon)
 *
 * Race condition possible si 2 push concurrents pour le meme tag passent le
 * SELECT en meme temps -> les 2 envoient. C est acceptable car le pire cas
 * est 2 push au lieu de 1 (vs 10 actuels). Pour une vraie atomicite il
 * faudra un RPC SQL ou un Redis SETNX.
 *
 * Sans tag : pas de dedup (compat retro pour les push qui ne specifient pas).
 */
async function checkPushDedup(tag: string | undefined, ttlSeconds = 60): Promise<boolean> {
  if (!tag) return true  // pas de tag = pas de dedup
  try {
    const supabase = createAdminClient()
    const cutoff = new Date(Date.now() - ttlSeconds * 1000).toISOString()

    // Verifie si le tag a ete envoye recemment
    const { data: existing } = await supabase
      .from('push_dedupe')
      .select('sent_at')
      .eq('tag', tag)
      .gte('sent_at', cutoff)
      .maybeSingle()

    if (existing) return false  // deja envoye < TTL -> skip

    // UPSERT pour marquer ce tag envoye (sera ignore au prochain check < TTL)
    await supabase
      .from('push_dedupe')
      .upsert({ tag, sent_at: new Date().toISOString() }, { onConflict: 'tag' })

    return true
  } catch (e: any) {
    // En cas d erreur (table manquante, RLS, etc.), on n empeche pas le push
    // pour ne pas casser les notifs en production.
    console.warn('[Push dedup] Exception, sending anyway:', e.message)
    return true
  }
}

/**
 * Envoie une notification push à tous les utilisateurs ayant un rôle donné.
 * Inclut les users dont `users.role` (champ principal) match, ainsi que ceux
 * dont `users.roles` (array multi-roles, ex: ["driver","dispatcher"]) contient
 * au moins un des roles demandes. Permet a un chauffeur-dispatcher de recevoir
 * les notifs nouvelles missions sans devoir bouger son role principal.
 */
export async function sendPushToRole(
  role:       string | string[],
  payload:    PushPayload,
  notifType?: NotifType,
): Promise<void> {
  // Anti-spam : skip si meme tag deja emis dans les 60s (cf checkPushDedup).
  const allowed = await checkPushDedup(payload.tag)
  if (!allowed) {
    console.log(`[Push dedup] Skip ${payload.tag} (deja envoye < 60s)`)
    return
  }
  const supabase = createAdminClient()
  const roles    = Array.isArray(role) ? role : [role]

  // OR sur 2 champs : `role` (string) IN [...] OR `roles` (array) overlaps [...]
  // L operateur PostgREST pour array overlap est `overlaps` ou `&&` en raw.
  // Ici on combine via .or() : role.in.(a,b,c) OR roles.cs.{a} (contained-set
  // pour chaque role recherche). On simplifie en faisant 2 queries puis union.
  const [byRole, byRolesArray] = await Promise.all([
    supabase.from('users').select('id').in('role', roles).eq('active', true),
    supabase.from('users').select('id, roles').eq('active', true).not('roles', 'is', null),
  ])

  const ids = new Set<string>()
  for (const u of byRole.data || []) ids.add(u.id)
  for (const u of byRolesArray.data || []) {
    if (Array.isArray(u.roles) && u.roles.some((r: string) => roles.includes(r))) {
      ids.add(u.id)
    }
  }

  if (ids.size === 0) return
  // Olivier 2026-06-06 PM : propage notifType pour respecter les preferences
  // du user (sinon filterByNotifPref n est jamais appele -> le toggle profil
  // ne fonctionne pas).
  await sendPushToUsers(Array.from(ids), payload, notifType)
}
