// GET /api/talkie/session → accès au talkie « Garde de nuit » (membres : 1er départ
// et réserve de la nuit ; superadmins : écoute seule). Cf lib/talkie/session.ts.
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { talkieSession }    from '@/lib/talkie/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await talkieSession(session.user as any))
}
