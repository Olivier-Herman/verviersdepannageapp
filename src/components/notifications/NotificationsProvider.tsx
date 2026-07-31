'use client'
// src/components/notifications/NotificationsProvider.tsx
//
// Souscrit a Supabase Realtime sur notifications_log filtre par user_id.
// Chaque INSERT → affiche un bandeau + joue le son. Stack de bandeaux
// si plusieurs notifs arrivent rapprochees.
//
// A monter dans AppShell (englobe toutes les pages connectees).

import { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react'
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

  // Ids déjà affichés (fermés/lus) — garde-fou local : empêche le poll 15 s ou
  // Realtime de ré-afficher un bandeau déjà traité, même avant que read_at soit
  // committé en base (sinon re-toast en boucle toutes les 15 s pendant 30 min).
  const seen = useRef<Set<string>>(new Set())

  // Register le push natif (no-op si pas dans Capacitor)
  usePushRegistration(userId)

  // Marque la notif comme lue en base (idempotent côté API). Utilisé aussi bien
  // à la fermeture (auto-dismiss / ✕) qu'au clic « Voir » : une notif in_app ne
  // sert qu'au toast, une fois affichée elle ne doit plus revenir.
  const persistRead = (id: string) => {
    fetch(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => {})
  }

  const dismiss = useCallback((id: string) => {
    seen.current.add(id)
    setPending(prev => prev.filter(n => n.id !== id))
    persistRead(id)
  }, [])

  const markRead = useCallback(async (id: string) => {
    seen.current.add(id)
    setPending(prev => prev.filter(n => n.id !== id))
    persistRead(id)
  }, [])

  useEffect(() => {
    if (!userId) return

    const sb = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    const handleNewNotif = (row: NotifEvent) => {
      if (row.channel && row.channel !== 'in_app') return
      if (row.read_at) return                    // déjà lue en base → jamais de toast
      if (seen.current.has(row.id)) return       // déjà affichée/fermée cette session
      let added = false
      setPending(prev => {
        if (prev.some(n => n.id === row.id)) return prev
        added = true
        return [...prev, row]
      })
      if (added) playNotificationSound(row.notif_type)
    }

    const channel = sb
      .channel(`notif-${userId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'notifications_log',
        filter: `user_id=eq.${userId}`,
      }, (payload) => handleNewNotif(payload.new as NotifEvent))
      .subscribe()

    // Polling fallback 15s : recupere les notifs in_app non lues recentes.
    // Si Realtime fire, l anti-duplicate (par id) evite les doublons. Si
    // Realtime echoue, le toast apparait quand meme en max 15s.
    let cancelled = false
    const pollUnread = async () => {
      try {
        const r = await fetch('/api/notifications/unread')
        if (!r.ok) return
        const j = await r.json()
        if (cancelled) return
        for (const n of (j.notifications || []) as NotifEvent[]) {
          handleNewNotif(n)
        }
      } catch {}
    }
    pollUnread()  // tick immediat
    const pollId = setInterval(pollUnread, 15_000)

    return () => {
      cancelled = true
      clearInterval(pollId)
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
