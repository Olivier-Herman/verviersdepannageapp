// src/app/api/admin/archives/unarchive/route.ts
// POST { id } → desarchive une mission (archived_at = NULL)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { id?: string }
  const id = (body.id || '').trim()
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { error } = await sb
    .from('incoming_missions')
    .update({ archived_at: null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
