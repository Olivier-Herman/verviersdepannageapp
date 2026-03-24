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
 */
export async function sendPushToRole(
  role:    string | string[],
  payload: PushPayload
): Promise<void> {
  const supabase = createAdminClient()
  const roles    = Array.isArray(role) ? role : [role]

  const { data: users } = await supabase
    .from('users')
    .select('id')
    .in('role', roles)
    .eq('active', true)

  if (!users?.length) return
  await sendPushToUsers(users.map(u => u.id), payload)
}
