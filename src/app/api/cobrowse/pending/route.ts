// src/app/api/cobrowse/pending/route.ts
// GET : liste des sessions pending (pour la page admin).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data } = await sb
    .from('cobrowse_sessions')
    .select(`
      id, user_id, user_message, user_url, user_agent,
      status, started_at, admin_id, admin_joined_at,
      user:user_id (id, name, email, role)
    `)
    .in('status', ['pending', 'active'])
    .order('started_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ sessions: data || [] })
}
