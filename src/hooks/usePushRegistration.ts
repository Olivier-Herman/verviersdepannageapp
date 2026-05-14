'use client'
// src/hooks/usePushRegistration.ts
//
// Hook qui detecte si l'app tourne dans Capacitor (wrapper natif iOS/Android)
// et register le device aupres d'APNs / FCM, puis envoie le token au backend.
//
// No-op si on est dans un navigateur classique (l'app web sans Capacitor).
//
// A monter une fois au niveau du shell (AppShell, AdminLayoutClient) — le
// register iOS demande la permission UNE seule fois puis renvoie le token
// au prochain appel meme sans demande.

import { useEffect, useRef } from 'react'

export function usePushRegistration(userId: string | null | undefined) {
  const registeredFor = useRef<string | null>(null)

  useEffect(() => {
    if (!userId) return
    if (registeredFor.current === userId) return  // deja registered pour ce user

    let cancelled = false
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return  // navigateur classique → no-op

        const { PushNotifications } = await import('@capacitor/push-notifications')

        // 1. Permission
        const perm = await PushNotifications.checkPermissions()
        if (perm.receive === 'prompt') {
          const req = await PushNotifications.requestPermissions()
          if (req.receive !== 'granted') {
            console.warn('[push] permission refusee par user')
            return
          }
        } else if (perm.receive !== 'granted') {
          console.warn('[push] permission non accordee :', perm.receive)
          return
        }

        // 2. Register listeners avant le call register() — sinon on rate l'event
        await PushNotifications.removeAllListeners()
        await PushNotifications.addListener('registration', async (tokenEvent) => {
          if (cancelled) return
          const token = tokenEvent.value
          const platform = Capacitor.getPlatform()  // 'ios' | 'android'

          try {
            const res = await fetch('/api/devices/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, platform }),
            })
            if (!res.ok) {
              console.error('[push] backend register failed:', res.status)
              return
            }
            registeredFor.current = userId
            console.log(`[push] device registered (${platform})`)
          } catch (e: any) {
            console.error('[push] backend register error:', e.message)
          }
        })

        await PushNotifications.addListener('registrationError', (err) => {
          console.error('[push] registration error:', err)
        })

        // 3. Trigger le register (APNs/FCM)
        await PushNotifications.register()

        // 4. Listener notif recue en foreground — on laisse le bandeau in-app
        //    s'afficher via le canal Realtime (sendNotification ecrit en DB).
        //    Ici juste pour debug / future utilisation.
        await PushNotifications.addListener('pushNotificationReceived', (notif) => {
          console.debug('[push] received foreground:', notif)
        })

        // 5. Listener tap notif (app en background)
        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const data = action.notification.data as any
          const url = data?.action_url || (data?.mission_id ? `/dispatch/${data.mission_id}` : null)
          if (url && typeof window !== 'undefined') {
            window.location.href = url
          }
        })
      } catch (e: any) {
        console.error('[push] init error:', e.message)
      }
    })()

    return () => { cancelled = true }
  }, [userId])
}
