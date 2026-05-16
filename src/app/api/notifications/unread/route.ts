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

  return NextResponse.json({ notifications: data || [] })
}
