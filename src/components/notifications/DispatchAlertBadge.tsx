'use client'
// src/components/notifications/DispatchAlertBadge.tsx
//
// Badge global "🆘 Dérogation à valider" affiche dans la sticky bar AppShell
// pour les roles dispatcher/admin/superadmin. Visible depuis n importe quelle
// page (dashboard, missions, etc) tant qu une demande pending existe — un
// chauffeur attend une reponse pour avancer, il faut une vraie alerte.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

interface Props {
  userRole: string
}

export default function DispatchAlertBadge({ userRole }: Props) {
  const [count, setCount] = useState(0)
  const [firstMissionId, setFirstMissionId] = useState<string | null>(null)

  const isDispatcher = ['admin', 'superadmin', 'dispatcher'].includes(userRole)

  const refresh = async () => {
    try {
      const r = await fetch('/api/dispatch/derogation-alerts')
      if (!r.ok) return
      const j = await r.json()
      setCount(j.count || 0)
      setFirstMissionId(j.first_mission_id || null)
    } catch {}
  }

  useEffect(() => {
    if (!isDispatcher) return
    refresh()
    // Realtime : toute creation/decision de derogation re-fetch
    const sb = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const ch = sb.channel('global-derogations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_derogations' }, () => refresh())
      .subscribe()
    // Polling de secours toutes les 30s si Realtime ne fire pas
    const id = setInterval(refresh, 30_000)
    return () => { sb.removeChannel(ch); clearInterval(id) }
  }, [isDispatcher])

  if (!isDispatcher || count === 0 || !firstMissionId) return null

  return (
    <Link
      href={`/dispatch/${firstMissionId}`}
      title="Un chauffeur attend une réponse à sa demande de dérogation paiement"
      className="inline-flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 border-2 border-red-400 text-white font-bold rounded-xl text-sm shadow-lg shadow-red-500/30 animate-pulse transition whitespace-nowrap"
    >
      <span className="text-lg leading-none">🆘</span>
      <span className="hidden sm:inline">DÉROGATION{count > 1 ? `S (${count})` : ''} À VALIDER</span>
      <span className="sm:hidden">{count}</span>
    </Link>
  )
}
