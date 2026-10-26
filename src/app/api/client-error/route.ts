// /api/client-error — plantage d'une page côté téléphone/navigateur (Olivier 21/10/2026, Fred Palm
// sur 10200234 : « Application error » sans détail). Enregistré dans error_logs (lu dans /admin/logs).
// Aussi chaque erreur affichée au chauffeur avec le bouton « Signaler à Sam » (26/10/2026) : la ligne créée
// donne la référence montrée à l'écran.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions).catch(() => null)
  const b = await req.json().catch(() => ({} as any))
  try {
    const { data } = await createAdminClient().from('error_logs').insert({
      level: b.level === 'warn' ? 'warn' : 'error', route: `client:${String(b.url || '').slice(0, 200)}`,
      message: String(b.message || 'erreur inconnue').slice(0, 1500),
      metadata: { stack: String(b.stack || '').slice(0, 4000), digest: b.digest || null, ua: req.headers.get('user-agent') || null, where: b.where || null, mission_id: b.mission_id || null, context: b.context && typeof b.context === 'object' ? b.context : null },
      user_id: (session?.user as any)?.id || null, user_email: session?.user?.email || null,
    }).select('id').single()
    return NextResponse.json({ ok: true, id: data?.id || null })
  } catch (e: any) {
    console.error('[client-error]', e?.message)
    return NextResponse.json({ ok: true, id: null })
  }
}
