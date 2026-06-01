// POST /api/admin/users/default-truck { user_id, default_truck_id }
// Permet a un admin d assigner une depanneuse par defaut a un chauffeur.
// Olivier 2026-06-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role: string = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const userId        = (body.user_id || '').trim()
  const defaultTruckId = body.default_truck_id === null || body.default_truck_id === ''
    ? null
    : String(body.default_truck_id).trim()

  if (!userId) return NextResponse.json({ error: 'user_id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('users')
    .update({ default_truck_id: defaultTruckId, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id, name, default_truck_id')
    .maybeSingle()

  if (error)  return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  return NextResponse.json({ ok: true, user: data })
}
