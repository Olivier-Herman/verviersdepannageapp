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

/**
 * Filtre une liste d'user_ids selon les preferences notif_preferences.
 * En l absence d entree pour la cle, le user est considere comme actif
 * (defaut on = retro-compat).
 */
async function filterByNotifPref(userIds: string[], notifType?: NotifType): Promise<string[]> {
  if (!notifType || userIds.length === 0) return userIds
  const sb = createAdminClient()
  const { data } = await sb
    .from('users')
    .select('id, notif_preferences')
    .in('id', userIds)
  if (!data) return userIds
  return data
    .filter(u => {
      const pref = (u.notif_preferences || {}) as Record<string, unknown>
      // explicite false → desactive, sinon active
      return pref[notifType] !== false
    })
    .map(u => u.id)
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
  await sendPushToUsers(Array.from(ids), payload)
}
