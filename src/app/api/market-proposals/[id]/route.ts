// src/app/api/market-proposals/[id]/route.ts
//
// Proposition de nuit Momo Market (Olivier 30/09/2026) — cf lib/missions/market-proposals.ts.
// GET  → état de la proposition (la page /proposition/<id> se rafraîchit dessus)
// POST { action, minutes?, pos? } → J'accepte / Je suis déjà en mission / combien de temps /
//      je confirme / rappel 15 min / j'appelle le client / client OK ou pas / renvoyer au 1er

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { respondProposal, closedMessage, type ProposalAction } from '@/lib/missions/market-proposals'

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
    phase:      p.phase,
    missionId:  p.mission_id,
    message:    p.status === 'pending' ? null : await closedMessage(sb, p),
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as any)?.id as string | undefined
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ACTIONS: ProposalAction[] = ['accept', 'busy', 'minutes', 'confirm_busy', 'snooze', 'client_call', 'client_ok', 'client_ko', 'return_first']
  const body = await req.json().catch(() => ({})) as { action?: string; minutes?: number; pos?: { lat?: number; lng?: number } }
  if (!ACTIONS.includes(body.action as ProposalAction)) return NextResponse.json({ error: 'action requise' }, { status: 400 })
  const pos = body.pos && Number.isFinite(body.pos.lat) && Number.isFinite(body.pos.lng) ? { lat: Number(body.pos.lat), lng: Number(body.pos.lng) } : null
  const r = await respondProposal(params.id, userId, body.action as ProposalAction, { minutes: body.minutes, pos })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, missionId: r.missionId, next: r.next || null })
}
