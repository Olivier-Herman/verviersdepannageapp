'use client'
// src/components/notifications/NotificationBanner.tsx
//
// Bandeau toast affiche par NotificationsProvider quand une notif arrive.
// Auto-dismiss apres 8 sec (12 sec si escalation), ou clic "Voir" → ouvre
// l'action_url et marque comme lue.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, Bell, AlertTriangle, Truck, FileText, Check } from 'lucide-react'
import { NOTIFICATION_TYPES } from '@/lib/notifications/types'

interface NotifEvent {
  id:         string
  notif_type: string
  payload:    {
    title:      string
    body:       string
    action_url?: string
    mission_id?: string
    data?:       Record<string, any>
  } | null
  created_at: string
}

const AUTO_DISMISS_MS         = 8000
const AUTO_DISMISS_ESCALATION = 0  // 0 = pas d'auto-dismiss pour escalade

/** Choix de l'icone selon le type de notif */
function iconFor(notifType: string) {
  if (notifType === 'escalation_call' || notifType === 'auto_dispatch_timeout') {
    return <AlertTriangle size={18} className="text-warning" />
  }
  if (notifType.startsWith('mission_') || notifType.includes('mission')) {
    return <Truck size={18} className="text-brand" />
  }
  if (notifType === 'email_parse_error' || notifType === 'check_vehicule_due') {
    return <FileText size={18} className="text-ink-secondary" />
  }
  if (notifType === 'payment_validated') {
    return <Check size={18} className="text-success" />
  }
  return <Bell size={18} className="text-brand" />
}

/** Couleur de bordure selon priorite (escalade = critical) */
function borderColorFor(notifType: string): string {
  if (notifType === 'escalation_call' || notifType === 'auto_dispatch_timeout') {
    return 'border-warning bg-warning-soft'
  }
  if (notifType === 'auto_dispatch_dispo_request') {
    return 'border-brand bg-brand/5'
  }
  return 'border bg-surface'
}

export default function NotificationBanner({
  notif, onDismiss, onMarkRead,
}: {
  notif:      NotifEvent
  onDismiss:  () => void
  onMarkRead: () => void
}) {
  const [enter, setEnter] = useState(false)

  // Animation slide-in
  useEffect(() => {
    const t = setTimeout(() => setEnter(true), 10)
    return () => clearTimeout(t)
  }, [])

  // Auto-dismiss timer (sauf pour les escalades qui restent jusqu'au clic)
  useEffect(() => {
    const ms = notif.notif_type === 'escalation_call'
      ? AUTO_DISMISS_ESCALATION
      : AUTO_DISMISS_MS
    if (ms === 0) return
    const t = setTimeout(() => {
      setEnter(false)
      setTimeout(onDismiss, 200)  // attend la fin de l'anim sortie
    }, ms)
    return () => clearTimeout(t)
  }, [notif.notif_type, onDismiss])

  const typeMeta  = NOTIFICATION_TYPES.find(t => t.key === notif.notif_type)
  const title     = notif.payload?.title || typeMeta?.label || 'Notification'
  const body      = notif.payload?.body  || ''
  const actionUrl = notif.payload?.action_url
                 || (notif.payload?.mission_id ? `/dispatch/${notif.payload.mission_id}` : null)

  return (
    <div
      role="alert"
      className={`${borderColorFor(notif.notif_type)} rounded-xl shadow-md border p-3 transition-all duration-200 ${
        enter ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 mt-0.5">{iconFor(notif.notif_type)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-ink text-sm font-semibold truncate">{title}</p>
          {body && <p className="text-ink-secondary text-xs mt-0.5 line-clamp-3">{body}</p>}

          {actionUrl && (
            <Link
              href={actionUrl}
              onClick={() => { onMarkRead() }}
              className="inline-block mt-2 text-brand text-xs font-medium hover:underline"
            >
              Voir →
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setEnter(false); setTimeout(onDismiss, 200) }}
          className="flex-shrink-0 text-ink-muted hover:text-ink p-0.5"
          aria-label="Fermer"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
