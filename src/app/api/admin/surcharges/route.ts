// src/app/api/admin/surcharges/route.ts
//
// API CRUD pour la matrice de majorations tarif (admin only).
//
// GET    /api/admin/surcharges            → { clients: [...], schedules: [...] }
// POST   /api/admin/surcharges/client     → { key, label, kind } : ajoute un client
// DELETE /api/admin/surcharges/client?key=...  : supprime un client (sauf snc + accident_police)
// PUT    /api/admin/surcharges/schedule   → remplace toutes les plages d'une (client, weekday) cellule

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 } as const
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return { error: 'Forbidden', status: 403 } as const
  }
  return { user } as const
}

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sb = createAdminClient()
  const [{ data: clients }, { data: schedules }] = await Promise.all([
    sb.from('surcharge_clients').select('*').order('kind').order('sort_order').order('label'),
    sb.from('surcharge_schedules').select('*'),
  ])

  return NextResponse.json({ clients: clients || [], schedules: schedules || [] })
}
