// /api/agents/propositions — file de propositions des agents (lot 1, 05/10/2026).
//   POST { type, societe, pourquoi, contenu, certain? } → dépôt (ou envoi direct permis)
//   GET  ?statut=to_validate|executed|refused|returned|failed → ses propositions
//        (refus et corrections à relire avant de reproposer).
import { NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agents/core'
import { submitProposal } from '@/lib/agents/proposals'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Corps JSON attendu.' }, { status: 400 })
  try { return NextResponse.json({ ok: true, ...(await submitProposal(agent, body)) }) }
  catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 400 }) }
}

export async function GET(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  const statut = new URL(req.url).searchParams.get('statut')
  let q = createAdminClient().from('agent_proposals').select('id, kind, company_id, title, status, amount, validated_by, validated_at, refused_reason, correction, result, error, created_at, executed_at')
    .eq('agent_id', agent.id).order('created_at', { ascending: false }).limit(50)
  if (statut) q = q.eq('status', statut)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, propositions: data })
}
