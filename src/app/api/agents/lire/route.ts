// GET /api/agents/lire?quoi=<lecture>&societe=<1|2|3>&…
// Lecture seule pour les agents HOOS (lot 1, Olivier 05/10/2026). Clé d'agent
// obligatoire (Authorization: Bearer vda_…), société obligatoire et vérifiée.
// Chaque lecture est notée dans le journal des agents.
import { NextResponse } from 'next/server'
import { authenticateAgent, checkCompany, journal } from '@/lib/agents/core'
import { READS, READ_LABEL, runRead, type ReadKind } from '@/lib/agents/read'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  const q = new URL(req.url).searchParams
  const quoi = String(q.get('quoi') || '') as ReadKind
  // Boîte des échanges avec le cabinet comptable (Olivier 05/10/2026) : Benoît seul, garde-fous dans comptable-mailbox.
  if ((quoi as string) === 'boite_comptable') {
    try {
      const { listComptableMails } = await import('@/lib/agents/comptable-mailbox')
      return NextResponse.json({ ok: true, quoi, data: await listComptableMails({ kind: 'agent', agent }) })
    } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 403 }) }
  }
  // Lectures du coordinateur (Victor, Olivier 07/10/2026) : propositions de tous les agents,
  // dossiers comptables (avec les clics et remarques de la comptable), pièces réclamées.
  if (['propositions', 'dossier_comptable', 'pieces_reclamees'].includes(quoi as string)) {
    const { COMPTABLE_AGENT } = await import('@/lib/agents/comptable-mailbox')
    if (agent.name !== COMPTABLE_AGENT) {
      await journal({ agent: agent.name, action: 'lecture refusée', detail: `${quoi} : réservé à ${COMPTABLE_AGENT}`, ok: false })
      return NextResponse.json({ error: `Lecture réservée à ${COMPTABLE_AGENT}.` }, { status: 403 })
    }
    const { createAdminClient } = await import('@/lib/supabase')
    const sb = createAdminClient()
    let data: any
    if ((quoi as string) === 'propositions') {
      const co = checkCompany(agent, q.get('societe'))
      if (!co.ok) return NextResponse.json({ error: co.error }, { status: 403 })
      let s = sb.from('agent_proposals').select('id, agent_name, kind, title, why, amount, status, refused_reason, correction, error, created_at, validated_by, validated_at, executed_at').eq('company_id', co.company).order('created_at', { ascending: false }).limit(200)
      if (q.get('depuis')) s = s.gte('created_at', q.get('depuis')!)
      if (q.get('agent')) s = s.eq('agent_name', q.get('agent')!)
      data = (await s).data || []
    } else if ((quoi as string) === 'dossier_comptable') {
      const { loadDossier } = await import('@/lib/compta/dossier')
      if (q.get('id')) data = await loadDossier(q.get('id')!)
      else data = (await sb.from('dossiers_comptables').select('id, company_id, titre, sous_titre, destinataire, created_at, updated_at').order('created_at', { ascending: false })).data || []
    } else {
      let s = sb.from('mail_piece_requests').select('*').order('requested_at', { ascending: false }).limit(200)
      if (q.get('etat')) s = s.eq('status', q.get('etat')!)
      data = (await s).data || []
    }
    await journal({ agent: agent.name, company: Number(q.get('societe')) || null, action: 'lecture', detail: `${quoi}${q.get('id') ? ` · ${q.get('id')}` : ''}` })
    return NextResponse.json({ ok: true, quoi, data })
  }
  if (!READS.includes(quoi)) return NextResponse.json({ error: `quoi inconnu. Lectures : ${READS.map(r => `${r} (${READ_LABEL[r]})`).join(', ')}.` }, { status: 400 })
  const co = checkCompany(agent, q.get('societe'))
  if (!co.ok) {
    await journal({ agent: agent.name, company: Number(q.get('societe')) || null, action: 'lecture refusée', detail: `${READ_LABEL[quoi]} · ${co.error}`, ok: false })
    return NextResponse.json({ error: co.error }, { status: 403 })
  }
  try {
    const data = await runRead(quoi, co.company, q)
    const n = Array.isArray(data) ? data.length : Object.values(data || {}).reduce((s: number, v: any) => s + (Array.isArray(v) ? v.length : 0), 0)
    await journal({ agent: agent.name, company: co.company, action: 'lecture', detail: `${READ_LABEL[quoi]} · ${n} résultat${n > 1 ? 's' : ''}${q.get('numero') ? ` · ${q.get('numero')}` : ''}${q.get('plaque') ? ` · ${q.get('plaque')}` : ''}` })
    return NextResponse.json({ ok: true, societe: co.company, quoi, data })
  } catch (e: any) {
    await journal({ agent: agent.name, company: co.company, action: 'lecture en échec', detail: `${READ_LABEL[quoi]} · ${e?.message || e}`, ok: false })
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 })
  }
}
