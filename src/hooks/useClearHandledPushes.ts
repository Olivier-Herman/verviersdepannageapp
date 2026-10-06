'use client'
// src/hooks/useClearHandledPushes.ts
//
// Retire de l'écran du téléphone les notifications devenues sans objet
// (Olivier 04/10/2026) : « une fois qu'il a fait l'action dans l'app, ça doit
// le retirer de l'écran ». Ex. : rappels « À accepter » restés affichés alors
// que la mission était acceptée puis clôturée.
//
// Quand : à l'ouverture de l'app, au retour au premier plan, à chaque
// changement d'écran, puis toutes les 30 s tant que l'app est visible.
// Le serveur décide (POST /api/notifications/stale) ; l'app ne fait que retirer.
// No-op dans un navigateur classique.

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export function useClearHandledPushes(userId: string | null | undefined) {
  const pathname = usePathname()
  useEffect(() => {
    if (!userId) return
    let stop = false, running = false
    const run = async () => {
      if (stop || running || document.visibilityState !== 'visible') return
      running = true
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        // Ancienne app de l'App Store (sans Live Activity) : app figée au retour du
        // verrouillage depuis le 05/10 chez Matthieu et Fred (Olivier 06/10/2026) —
        // traitement coupé sur ces versions le temps de confirmer la cause.
        if (Capacitor.getPlatform() === 'ios' && !Capacitor.isPluginAvailable('LiveActivity')) return
        const { PushNotifications } = await import('@capacitor/push-notifications')
        const { notifications } = await PushNotifications.getDeliveredNotifications()
        if (!notifications?.length) return
        const field = (n: any, k: string) => {
          const v = n?.data?.[k] ?? n?.data?.data?.[k] ?? n?.[k]
          return typeof v === 'string' ? v : null
        }
        // Jamais les popups bloquants ni les questions : ils attendent une réponse.
        const askReply = (n: any) => ['modal', 'question'].some(k => { const v = n?.data?.[k] ?? n?.data?.data?.[k]; return v === true || v === 'true' })
        const items = notifications.filter(n => !askReply(n)).map(n => ({
          key:        String(n.id),
          mission_id: field(n, 'mission_id'),
          action_url: field(n, 'action_url'),
          notif_type: field(n, 'notif_type'),
          attempt_id: field(n, 'attempt_id'),
        })).filter(i => i.mission_id || i.action_url)
        if (!items.length) return
        const r = await fetch('/api/notifications/stale', {
          method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        })
        if (!r.ok) return
        const { keys } = await r.json()
        const drop = new Set<string>(Array.isArray(keys) ? keys : [])
        const toRemove = notifications.filter(n => drop.has(String(n.id)))
        if (toRemove.length) await PushNotifications.removeDeliveredNotifications({ notifications: toRemove })
      } catch (e: any) {
        console.debug('[push] nettoyage des notifs :', e?.message)
      } finally { running = false }
    }
    run()
    const onVis = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVis)
    const id = setInterval(run, 30_000)
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [userId, pathname])
}
