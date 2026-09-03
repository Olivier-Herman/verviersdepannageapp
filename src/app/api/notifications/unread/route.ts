// src/app/api/notifications/unread/route.ts
//
// GET : retourne les notifications in_app non lues de l user courant.
// Utilise par NotificationsProvider en polling 15s pour pallier les eventuels
// echecs de Realtime (websocket coupe, table pas dans la publication, etc).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ notifications: [] })

  const sb = createAdminClient()
  const { data: me } = await sb
    .from('users')
    .select('id')
    .eq('email', session.user.email!)
    .single()
  if (!me) return NextResponse.json({ notifications: [] })

  // Notifications in_app non lues des 30 dernieres minutes (les plus
  // anciennes sont considerees expirees pour le toast — l user aurait
  // du reagir avant)
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { data } = await sb
    .from('notifications_log')
    .select('id, user_id, notif_type, payload, channel, created_at, read_at, responded_at')
    .eq('user_id', me.id)
    .eq('channel', 'in_app')
    .is('read_at', null)
    .gt('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(20)

  let notifs = data || []

  // Popups BLOQUANTS (payload.data.modal) : ils exigent une RÉPONSE, pas une
  // simple lecture → on les renvoie tant que responded_at est vide, même si
  // read_at a été posé (ex. auto-dismiss d'un ancien client) et sans limite
  // de 30 min. Olivier 2026-09-03.
  const { data: blocking } = await sb
    .from('notifications_log')
    .select('id, user_id, notif_type, payload, channel, created_at, read_at, responded_at')
    .eq('user_id', me.id)
    .eq('channel', 'in_app')
    .is('responded_at', null)
    .eq('payload->data->>modal', 'true')
    .order('created_at', { ascending: false })
    .limit(5)
  for (const b of (blocking || [])) if (!notifs.some(n => n.id === b.id)) notifs.push(b)

  // Notifs « nouvelle mission » : inutiles si la mission a deja ete prise en
  // charge (acceptee / demarree / cloturee...). On les retire du toast ET on
  // les marque lues pour qu'elles ne reviennent plus.
  const NEW_MISSION_TYPES = ['mission_assigned_manual', 'auto_dispatch_dispo_request']
  const HANDLED_STATUSES  = ['accepted', 'in_progress', 'delivering', 'parked', 'to_invoice', 'completed', 'cancelled', 'ignored']
  const missionOf = (n: any) => n.payload?.mission_id || null
  const candidates = notifs.filter(n => NEW_MISSION_TYPES.includes(n.notif_type) && missionOf(n))
  if (candidates.length) {
    const mids = [...new Set(candidates.map(missionOf))]
    const { data: ms } = await sb.from('incoming_missions').select('id, status').in('id', mids)
    const statusById = new Map((ms || []).map((m: any) => [m.id, m.status]))
    const stale = candidates.filter(n => HANDLED_STATUSES.includes(statusById.get(missionOf(n)) || ''))
    if (stale.length) {
      const staleIds = stale.map(n => n.id)
      await sb.from('notifications_log').update({ read_at: new Date().toISOString() }).in('id', staleIds)
      const drop = new Set(staleIds)
      notifs = notifs.filter(n => !drop.has(n.id))
    }
  }

  return NextResponse.json({ notifications: notifs })
}
