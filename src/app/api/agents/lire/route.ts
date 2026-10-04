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
