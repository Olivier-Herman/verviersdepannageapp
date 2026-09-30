// POST /api/talkie/ping { key, online } — début d'une prise de parole (Olivier
// 30/09/2026) : les membres du canal qui n'ont pas l'app à l'écran reçoivent tout de
// suite « 📻 X parle en ce moment » (au plus une notif toutes les 2 min par personne).
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { talkieChannel }    from '@/lib/talkie/session'
import { notifyTalkie }     from '@/lib/talkie/notify'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const body = await req.json().catch(() => ({})) as { key?: string; online?: string[] }
  const t = await talkieChannel(session?.user as any, String(body.key || 'garde'))
  if (!t) return NextResponse.json({ error: 'Canal non autorisé.' }, { status: 403 })
  const sent = await notifyTalkie(t, new Set(Array.isArray(body.online) ? body.online : []), 'start')
  return NextResponse.json({ ok: true, sent })
}
