// src/lib/push.ts
// Helper pour envoyer des notifications push Web Push (VAPID)

import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase'

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

/**
 * Envoie une notification push à un utilisateur spécifique.
 * Supprime automatiquement les abonnements invalides (expirés/révoqués).
 */
export async function sendPushToUser(
  userId:  string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const supabase = createAdminClient()

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)

  if (!subs?.length) return { sent: 0, failed: 0 }

  let sent = 0, failed = 0

  for (const sub of subs) {
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
      // 410 Gone ou 404 = abonnement révoqué → supprimer
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('id', sub.id)
        console.log(`[Push] Abonnement révoqué supprimé: ${sub.id}`)
      } else {
        console.error(`[Push] Erreur envoi ${sub.id}:`, err.message)
      }
      failed++
    }
  }

  return { sent, failed }
}

/**
 * Envoie une notification push à plusieurs utilisateurs.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<void> {
  await Promise.allSettled(userIds.map(id => sendPushToUser(id, payload)))
}

/**
 * Envoie une notification push à tous les utilisateurs ayant un rôle donné.
 * Inclut les users dont `users.role` (champ principal) match, ainsi que ceux
 * dont `users.roles` (array multi-roles, ex: ["driver","dispatcher"]) contient
 * au moins un des roles demandes. Permet a un chauffeur-dispatcher de recevoir
 * les notifs nouvelles missions sans devoir bouger son role principal.
 */
export async function sendPushToRole(
  role:    string | string[],
  payload: PushPayload
): Promise<void> {
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
