'use client'
// src/components/notifications/NotificationsProvider.tsx
//
// Souscrit a Supabase Realtime sur notifications_log filtre par user_id.
// Chaque INSERT → affiche un bandeau + joue le son. Stack de bandeaux
// si plusieurs notifs arrivent rapprochees.
//
// A monter dans AppShell (englobe toutes les pages connectees).

import { useEffect, useState, useCallback, createContext, useContext } from 'react'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { playNotificationSound } from '@/lib/notifications/sounds'
import { usePushRegistration } from '@/hooks/usePushRegistration'
import NotificationBanner from './NotificationBanner'

interface NotifEvent {
  id:           string
  user_id:      string
  notif_type:   string
  payload:      {
    title:      string
    body:       string
    action_url?: string
    mission_id?: string
    data?:       Record<string, any>
  } | null
  channel:      string
  created_at:   string
  read_at:      string | null
  responded_at: string | null
}

interface NotificationsContextValue {
  dismiss:   (id: string) => void
  markRead:  (id: string) => Promise<void>
  pending:   NotifEvent[]
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications doit etre utilise dans NotificationsProvider')
  return ctx
}

export default function NotificationsProvider({
  userId,
  children,
}: {
  userId: string | null
  children: React.ReactNode
}) {
  const [pending, setPending] = useState<NotifEvent[]>([])

  // Register le push natif (no-op si pas dans Capacitor)
  usePushRegistration(userId)

  const dismiss = useCallback((id: string) => {
    setPending(prev => prev.filter(n => n.id !== id))
  }, [])

  const markRead = useCallback(async (id: string) => {
    setPending(prev => prev.filter(n => n.id !== id))
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'POST' })
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    if (!userId) return

    const sb = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    const channel = sb
      .channel(`notif-${userId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications_log',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const row = payload.new as NotifEvent
        // Filtre : on n'affiche le bandeau que pour le canal in_app.
        // Les rows channel='push' sont des logs de tentative d'envoi natif
        // qu'on insere aussi mais qui ne doivent pas declencher de toast.
        if (row.channel && row.channel !== 'in_app') return
        // Anti-duplicate (Realtime peut redeliver)
        setPending(prev => {
          if (prev.some(n => n.id === row.id)) return prev
          return [...prev, row]
        })
        playNotificationSound(row.notif_type)
      })
      .subscribe()

    return () => {
      sb.removeChannel(channel)
    }
  }, [userId])

  return (
    <NotificationsContext.Provider value={{ dismiss, markRead, pending }}>
      {children}
      {/* Stack de bandeaux : top-right, plus recente en haut */}
      {pending.length > 0 && (
        <div className="fixed top-4 right-4 z-[300] flex flex-col gap-2 pointer-events-none max-w-sm w-full sm:max-w-md">
          {pending.slice(-5).reverse().map(n => (
            <div key={n.id} className="pointer-events-auto">
              <NotificationBanner
                notif={n}
                onDismiss={() => dismiss(n.id)}
                onMarkRead={() => markRead(n.id)}
              />
            </div>
          ))}
        </div>
      )}
    </NotificationsContext.Provider>
  )
}
