// GET /api/talkie/session → canaux du talkie accessibles (Garde de nuit ; direct
// vers Mobi / IT). Cf lib/talkie/session.ts.
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { talkieAccess }     from '@/lib/talkie/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await talkieAccess(session.user as any))
}
