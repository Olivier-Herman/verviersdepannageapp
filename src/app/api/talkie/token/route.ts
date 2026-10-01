// GET /api/talkie/token?key=garde|direct:<id> → { url, token } pour rejoindre le canal
// sur le serveur vocal LiveKit (Olivier 01/10/2026). 503 si LiveKit n'est pas configuré
// (l'app reste alors sur la voix par Supabase).
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { talkieChannel }    from '@/lib/talkie/session'
import { livekitToken }     from '@/lib/talkie/livekit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const key = new URL(req.url).searchParams.get('key') || 'garde'
  const t = await talkieChannel(session?.user as any, key)
  if (!t) return NextResponse.json({ error: 'Canal non autorisé.' }, { status: 403 })
  const lk = livekitToken(t.ch.channel, t.access.me!.id, t.access.me!.name)
  if (!lk) return NextResponse.json({ error: 'Serveur vocal non configuré.' }, { status: 503 })
  return NextResponse.json(lk)
}
