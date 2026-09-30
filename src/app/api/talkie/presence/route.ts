// POST /api/talkie/presence { visible } — l'app à l'écran le signale toutes les 10 s ;
// « visible: false » (envoyé en quittant l'écran) remet la présence à zéro. Le serveur
// s'en sert pour savoir à qui envoyer la notif du talkie (lib/talkie/notify.ts).
// Olivier 30/09/2026.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let visible = true
  try { const b = JSON.parse(await req.text() || '{}'); visible = b.visible !== false } catch { /* corps vide : visible */ }
  await createAdminClient().from('talkie_presence').upsert({ user_id: userId, seen_at: visible ? new Date().toISOString() : null }, { onConflict: 'user_id' })
  return NextResponse.json({ ok: true })
}
