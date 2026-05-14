// src/app/api/admin/notifications/route.ts
//
// GET   /api/admin/notifications → { users: [...], preferences: [...] }
// PATCH /api/admin/notifications { user_id, notif_type, enabled } → upsert
//
// Admin/superadmin only. Le frontend (NotificationsClient) merge les prefs
// explicites avec les defaults definis dans src/lib/notifications/types.ts.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { NOTIFICATION_TYPES } from '@/lib/notifications/types'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 } as const
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return { error: 'Forbidden', status: 403 } as const
  }
  return { session } as const
}

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sb = createAdminClient()

  const [{ data: users }, { data: prefs }] = await Promise.all([
    sb.from('users')
      .select('id, name, email, role, active')
      .eq('active', true)
      .order('role')
      .order('name'),
    sb.from('notification_preferences')
      .select('user_id, notif_type, enabled'),
  ])

  return NextResponse.json({
    users:       users || [],
    preferences: prefs || [],
  })
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json() as { user_id?: string; notif_type?: string; enabled?: boolean }
  const { user_id, notif_type, enabled } = body
  if (!user_id || !notif_type || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'user_id, notif_type, enabled requis' }, { status: 400 })
  }
  if (!NOTIFICATION_TYPES.some(t => t.key === notif_type)) {
    return NextResponse.json({ error: `notif_type inconnu: ${notif_type}` }, { status: 400 })
  }

  const sb = createAdminClient()
  const { error } = await sb
    .from('notification_preferences')
    .upsert({
      user_id,
      notif_type,
      enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,notif_type' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
