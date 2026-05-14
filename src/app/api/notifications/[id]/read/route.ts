// src/app/api/notifications/[id]/read/route.ts
//
// POST /api/notifications/[id]/read → marque la notification comme lue
// par l'utilisateur connecte. Ne permet de marquer QUE ses propres notifs.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d\'identite' }, { status: 401 })

  const sb = createAdminClient()
  const { error } = await sb
    .from('notifications_log')
    .update({ read_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', userId)
    .is('read_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
