// POST /api/users/me/audio-mode
// Active/desactive le mode assistance audio (long-press = lecture a voix haute).
// Olivier 2026-05-28.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const body = await req.json().catch(() => ({}))
  const audioMode = !!body.audio_mode

  const sb = createAdminClient()
  const { error } = await sb
    .from('users')
    .update({ audio_mode: audioMode })
    .eq('id', user.id)

  if (error) {
    console.error('[users/me/audio-mode]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, audio_mode: audioMode })
}
