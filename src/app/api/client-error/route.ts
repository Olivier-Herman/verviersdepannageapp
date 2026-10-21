// /api/client-error — plantage d'une page côté téléphone/navigateur (Olivier 21/10/2026, Fred Palm
// sur 10200234 : « Application error » sans détail). Enregistré dans error_logs (lu dans /admin/logs).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions).catch(() => null)
  const b = await req.json().catch(() => ({} as any))
  await logError({
    level: 'error', route: `client:${String(b.url || '').slice(0, 200)}`,
    message: String(b.message || 'erreur inconnue').slice(0, 1500),
    metadata: { stack: String(b.stack || '').slice(0, 4000), digest: b.digest || null, ua: req.headers.get('user-agent') || null, where: b.where || null },
    userId: (session?.user as any)?.id || null, userEmail: session?.user?.email || null,
  })
  return NextResponse.json({ ok: true })
}
