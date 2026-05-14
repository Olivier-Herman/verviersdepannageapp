// src/app/api/notifications/test/route.ts
//
// POST /api/notifications/test → envoie une notif test au user connecte
// pour valider que le canal in-app fonctionne (Realtime + bandeau + son).
//
// Body optionnel : { type?, title?, body? }
// Si pas fourni : envoie une notif "new_mission_received" par defaut.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sendNotification }  from '@/lib/notifications/send'
import { NOTIFICATION_TYPES } from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d\'identite' }, { status: 401 })

  let body: any = {}
  try { body = await req.json() } catch { /* body vide OK */ }

  const type  = body.type  || 'new_mission_received'
  const title = body.title || `Test notification (${type})`
  const text  = body.body  || 'Si tu vois ce bandeau avec un son, le canal in-app fonctionne. Clique sur ✕ pour fermer.'

  if (!NOTIFICATION_TYPES.some(t => t.key === type)) {
    return NextResponse.json({
      error: `Type inconnu: ${type}`,
      available: NOTIFICATION_TYPES.map(t => t.key),
    }, { status: 400 })
  }

  const result = await sendNotification(userId, type, {
    title,
    body: text,
    data: { source: 'test_endpoint' },
  })

  return NextResponse.json(result)
}
