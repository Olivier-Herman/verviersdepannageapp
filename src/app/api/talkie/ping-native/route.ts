// POST /api/talkie/ping-native { key } — prise de parole depuis l'écran verrouillé de
// l'iPhone (module natif, Olivier 01/10/2026). Pas de session web à ce moment-là :
// l'appel est authentifié par le jeton du serveur vocal du canal (Authorization:
// Bearer …), dont on vérifie la signature, la salle et l'accès actuel au canal.
// Effet identique à /api/talkie/ping : les autres membres sont prévenus.
import { NextResponse }       from 'next/server'
import { talkieChannel }      from '@/lib/talkie/session'
import { notifyTalkie }       from '@/lib/talkie/notify'
import { verifyLivekitToken, baseIdentity } from '@/lib/talkie/livekit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const v = bearer ? verifyLivekitToken(bearer) : null
  if (!v) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { key?: string }
  const t = await talkieChannel({ id: baseIdentity(v.identity) }, String(body.key || 'garde'))
  if (!t || t.ch.channel !== v.room) return NextResponse.json({ error: 'Canal non autorisé.' }, { status: 403 })
  const sent = await notifyTalkie(t, new Set(), 'start')
  return NextResponse.json({ ok: true, sent })
}
