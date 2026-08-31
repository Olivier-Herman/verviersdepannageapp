// POST /api/mail-agent/mode  { mode: 'draft' | 'auto' }
// Bascule le niveau d'autonomie. Superadmin uniquement : passer en 'auto'
// autorise l'agent à écrire en comptabilité sans relecture.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { roles: ['superadmin'] }).ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { mode } = await req.json().catch(() => ({ mode: null }))
  if (!['draft', 'auto'].includes(mode)) {
    return NextResponse.json({ error: 'mode doit valoir draft ou auto' }, { status: 400 })
  }
  const sb = createAdminClient()
  // app_settings.value est du TEXTE : on stocke du JSON sérialisé.
  const { error } = await sb.from('app_settings')
    .upsert({ key: 'mail_agent_mode', value: JSON.stringify(mode) }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode })
}
