// POST /api/agents/dossiers — mise à jour d'un point d'un dossier comptable par l'agent comptable
// (Victor, Olivier 07/10/2026) : { point_id, etat?, reponse?, suivi?, note?, document?: { nom, base64, type } }.
import { NextResponse } from 'next/server'
import { authenticateAgent, journal } from '@/lib/agents/core'
import { COMPTABLE_AGENT } from '@/lib/agents/comptable-mailbox'
import { updatePoint, addDoc } from '@/lib/compta/dossier'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'Clé d’agent absente, invalide ou désactivée.' }, { status: 401 })
  if (agent.name !== COMPTABLE_AGENT) { await journal({ agent: agent.name, action: 'dossier comptable refusé', ok: false }); return NextResponse.json({ error: `Réservé à ${COMPTABLE_AGENT}.` }, { status: 403 }) }
  const b = await req.json().catch(() => ({}))
  const { data: p } = await createAdminClient().from('dossier_comptable_points').select('id, numero, compte').eq('id', String(b?.point_id || '')).maybeSingle()
  if (!p) return NextResponse.json({ error: 'point_id inconnu.' }, { status: 404 })
  if (b.etat && !['regle', 'fournisseur', 'interne'].includes(b.etat)) return NextResponse.json({ error: 'etat : regle | fournisseur | interne.' }, { status: 400 })
  try {
    let docId: string | null = null
    if (b.document?.base64 && b.document?.nom) docId = await addDoc(p.id, String(b.document.nom).slice(0, 200), Buffer.from(b.document.base64, 'base64'), b.document.type || 'application/pdf')
    const patch: any = {}
    if (b.etat) patch.etat = b.etat
    if (typeof b.reponse === 'string') patch.reponse = b.reponse.slice(0, 4000)
    if (b.suivi !== undefined) patch.suivi = b.suivi ? String(b.suivi).slice(0, 300) : null
    if (Object.keys(patch).length || b.note) await updatePoint(p.id, patch, b.note ? String(b.note).slice(0, 1000) : undefined)
    await journal({ agent: agent.name, action: 'dossier comptable : point mis à jour', detail: `n° ${p.numero} ${p.compte}${b.etat ? ` → ${b.etat}` : ''}${docId ? ' + pièce' : ''}` })
    return NextResponse.json({ ok: true, document_id: docId })
  } catch (e: any) { return NextResponse.json({ error: String(e?.message || e) }, { status: 400 }) }
}
