// src/app/api/market-proposals/[id]/route.ts
//
// Proposition de nuit Momo Market (Olivier 30/09/2026) — cf lib/missions/market-proposals.ts.
// GET  → état de la proposition (la page /proposition/<id> se rafraîchit dessus)
// POST { action: 'accept' | 'busy' } → « J'accepte » / « Je suis déjà en mission »

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { respondProposal, closedMessage } from '@/lib/missions/market-proposals'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: p } = await sb.from('market_proposals').select('*').eq('id', params.id).maybeSingle()
  if (!p || p.driver_id !== userId) return NextResponse.json({ error: 'Proposition introuvable' }, { status: 404 })
  return NextResponse.json({
    status:     p.status,
    missionId:  p.mission_id,
    message:    p.status === 'pending' ? null : await closedMessage(sb, p),
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { action?: string }
  if (body.action !== 'accept' && body.action !== 'busy') return NextResponse.json({ error: 'action requise' }, { status: 400 })
  const r = await respondProposal(params.id, userId, body.action)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, missionId: r.missionId })
}
