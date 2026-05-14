// src/app/api/devices/unregister/route.ts
//
// POST /api/devices/unregister { token }
//
// Appelé au logout ou quand l'utilisateur désactive les push.
// Supprime le device_token correspondant pour ce user.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const body = await req.json() as { token?: string }
  const token = (body.token || '').trim()
  if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 })

  const sb = createAdminClient()
  const { error } = await sb
    .from('device_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('token', token)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
