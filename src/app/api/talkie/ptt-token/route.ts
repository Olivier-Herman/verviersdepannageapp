// POST /api/talkie/ptt-token { token, keys } — jeton « Push to Talk » de l'iPhone
// (Olivier 01/10/2026) : remis par le module natif quand l'app rejoint le canal talkie
// système. Le serveur s'en sert pour réveiller le téléphone (même verrouillé, app
// fermée) quand quelqu'un parle — lib/talkie/notify.ts.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { token?: string; keys?: string[] }
  const token = String(b.token || '').trim().toLowerCase()
  if (!/^[0-9a-f]{32,200}$/.test(token)) return NextResponse.json({ error: 'Jeton invalide.' }, { status: 400 })
  const keys = (Array.isArray(b.keys) ? b.keys : []).map(String).filter(k => /^(garde|direct:[0-9a-f-]{36})$/.test(k)).slice(0, 10)
  const { error } = await createAdminClient().from('talkie_ptt_tokens')
    .upsert({ token, user_id: userId, keys, updated_at: new Date().toISOString() }, { onConflict: 'token' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
