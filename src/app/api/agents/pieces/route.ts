// POST /api/agents/pieces — inscription d'une demande de pièce au registre (Olivier 07/10/2026) :
// { fournisseur, emails[], objet, envoye_le, message_id, boite, conversation_id?, societe, reference?, point_id? }.
import { NextResponse } from 'next/server'
import { authenticateAgent, checkCompany, journal } from '@/lib/agents/core'
import { registerPieceRequest } from '@/lib/mail-agent/pieces'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const co = checkCompany(agent, b?.societe)
  if (!co.ok) return NextResponse.json({ error: co.error }, { status: 403 })
  const emails = (Array.isArray(b?.emails) ? b.emails : []).map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /@/.test(e))
  if (!emails.length || !b?.message_id || !b?.boite || !b?.objet || !b?.envoye_le) return NextResponse.json({ error: 'emails, message_id, boite, objet et envoye_le obligatoires.' }, { status: 400 })
  await registerPieceRequest(createAdminClient(), { mailbox: String(b.boite), messageId: String(b.message_id), emails, subject: String(b.objet), sentAt: String(b.envoye_le), conversationId: b.conversation_id || null, companyId: co.company, fournisseur: b.fournisseur || null, reference: b.reference || null, dossierPointId: b.point_id || null })
  await journal({ agent: agent.name, company: co.company, action: 'pièce réclamée inscrite', detail: `${b.fournisseur || emails.join(', ')} · ${String(b.objet).slice(0, 150)}` })
  return NextResponse.json({ ok: true })
}
