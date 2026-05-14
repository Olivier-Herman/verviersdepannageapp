// src/lib/notifications/push.ts
//
// Dispatcher central pour envoyer un push natif a un user.
// Lookup tous les device_tokens du user, dispatch vers APNs (iOS) ou
// FCM (Android), nettoie les tokens invalides (410 Gone, BadDeviceToken).

import { createAdminClient } from '@/lib/supabase'
import { sendApnsPush, type ApnsPayload } from './push-apns'
import { sendFcmPush, type FcmPayload }   from './push-fcm'

export interface PushPayload {
  title:       string
  body:        string
  action_url?: string
  mission_id?: string
  notif_type?: string
  data?:       Record<string, any>
}

export interface PushResult {
  sent:           number
  failed:         number
  invalid_tokens: number
  no_devices:     boolean
}

/**
 * Envoie un push notif a tous les devices enregistres du user.
 * Best-effort : ne throw pas, log les erreurs et continue.
 */
export async function sendPushNotification(
  userId:  string,
  payload: PushPayload,
): Promise<PushResult> {
  const sb = createAdminClient()
  const { data: tokens } = await sb
    .from('device_tokens')
    .select('id, token, platform')
    .eq('user_id', userId)

  if (!tokens || tokens.length === 0) {
    return { sent: 0, failed: 0, invalid_tokens: 0, no_devices: true }
  }

  let sent           = 0
  let failed         = 0
  let invalid_tokens = 0
  const invalidIds: string[] = []

  await Promise.all(tokens.map(async (t) => {
    const res = t.platform === 'ios'
      ? await sendApnsPush(t.token, payload as ApnsPayload)
      : await sendFcmPush(t.token, payload as FcmPayload)

    if (res.ok) sent++
    else {
      failed++
      if (res.invalid_token) { invalid_tokens++; invalidIds.push(t.id) }
      console.warn(`[push] ${t.platform} fail token=${t.id} status=${res.status} reason=${res.reason}`)
    }
  }))

  // Cleanup des tokens invalides (app desinstallée, token revoque)
  if (invalidIds.length > 0) {
    await sb.from('device_tokens').delete().in('id', invalidIds)
  }

  return { sent, failed, invalid_tokens, no_devices: false }
}
