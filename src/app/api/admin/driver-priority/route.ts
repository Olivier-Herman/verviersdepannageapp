// src/app/api/admin/driver-priority/route.ts
//
// PATCH /api/admin/driver-priority { order: [driverId1, driverId2, ...] }
//
// Met a jour users.priority_order selon l'ordre fourni (1, 2, 3...).
// Les drivers non listes gardent leur valeur actuelle. L'ordre est global
// (tous les dispatchers voient le meme classement).
//
// Acces : admin / superadmin / dispatcher.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin', 'dispatcher'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { order?: string[] }
  const order = Array.isArray(body.order) ? body.order : null
  if (!order) return NextResponse.json({ error: 'order requis (array)' }, { status: 400 })

  const sb = createAdminClient()

  // Bump tous les drivers listes selon leur position. Position 0 = priorite 1.
  const updates = order.map((driverId, idx) =>
    sb.from('users').update({ priority_order: idx + 1 }).eq('id', driverId)
  )

  const results = await Promise.all(updates)
  const firstError = results.find(r => r.error)?.error
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated: order.length })
}
