// POST /api/market-proposals/test → lance un test des propositions de nuit sur le
// téléphone de l'utilisateur connecté (Olivier 30/09/2026). Cf startTestProposal.

import { NextResponse }       from 'next/server'
import { getServerSession }   from 'next-auth'
import { authOptions }        from '@/lib/auth'
import { startTestProposal }  from '@/lib/missions/market-proposals'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await startTestProposal(userId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, id: r.id })
}
