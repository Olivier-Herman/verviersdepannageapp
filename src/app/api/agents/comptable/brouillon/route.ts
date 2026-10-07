// POST /api/agents/comptable/brouillon — brouillon de réponse dans le fil d'un mail du cabinet
// (boîte comptable de Mobi). Jamais envoyé. { repondre_a, html, pieces?: [{ nom, base64, type }] }.
import { NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agents/core'
import { draftReplyComptable } from '@/lib/agents/comptable-mailbox'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!b?.repondre_a || !b?.html) return NextResponse.json({ error: 'repondre_a et html obligatoires.' }, { status: 400 })
  try {
    const pieces = (Array.isArray(b.pieces) ? b.pieces : []).filter((x: any) => x?.nom && x?.base64).map((x: any) => ({ name: String(x.nom).slice(0, 200), contentType: x.type || 'application/pdf', contentBytes: String(x.base64) }))
    const r = await draftReplyComptable({ kind: 'agent', agent }, String(b.repondre_a), String(b.html), pieces)
    return NextResponse.json({ ok: true, brouillon_id: r.id })
  } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 403 }) }
}
