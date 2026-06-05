// src/app/api/cobrowse/my-status/route.ts
// GET : retourne la session pending/active du user courant (pour banniere + recorder).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ session: null })

  const sb = createAdminClient()
  const { data: user } = await sb.from('users').select('id').eq('email', session.user.email!).single()
  if (!user) return NextResponse.json({ session: null })

  const { data } = await sb
    .from('cobrowse_sessions')
    .select(`
      id, status, started_at, admin_joined_at,
      admin:admin_id (id, name)
    `)
    .eq('user_id', user.id)
    .in('status', ['pending', 'active'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ session: data || null })
}
