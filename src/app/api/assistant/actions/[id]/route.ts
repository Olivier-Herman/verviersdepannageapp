// src/app/api/assistant/actions/[id]/route.ts
//
// POST { decision: 'confirmer' | 'annuler' } — la personne tranche l'action que son
// assistant bureau a déposée (Olivier 14/10/2026). Confirmée : VD Soft l'exécute avec
// SON compte (lib/assistant/bureau executeAction). Le résultat est ajouté à la
// conversation pour que l'assistant le voie au tour suivant.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { assistantOwner }    from '@/lib/assistant/access'
import { executeAction, ACTION_LABEL, type ActionKind } from '@/lib/assistant/bureau'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sb = createAdminClient()
  const { data: a } = await sb.from('assistant_actions').select('*').eq('id', params.id).maybeSingle()
  if (!a) return NextResponse.json({ error: 'Action introuvable' }, { status: 404 })
  const auth = await assistantOwner(a.conversation_id)
  if (!auth || a.user_id !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const decision = body.decision === 'confirmer' ? 'confirmer' : body.decision === 'annuler' ? 'annuler' : null
  if (!decision) return NextResponse.json({ error: 'decision : confirmer ou annuler' }, { status: 400 })

  // Une seule décision : on réserve l'action avant d'exécuter (double clic, deux onglets).
  const now = new Date().toISOString()
  const { data: claimed } = await sb.from('assistant_actions').update({ status: decision === 'annuler' ? 'annulee' : 'en_cours', decided_at: now })
    .eq('id', a.id).eq('status', 'en_attente').select('id')
  if (!claimed?.length) return NextResponse.json({ error: 'Cette action a déjà été tranchée.' }, { status: 409 })

  const label = ACTION_LABEL[a.kind as ActionKind] || a.kind
  let status = 'annulee', result: any = null, error: string | null = null
  if (decision === 'confirmer') {
    try {
      result = await executeAction({ kind: a.kind, mission_id: a.mission_id, payload: a.payload }, { id: auth.user.id, name: auth.user.name || auth.user.email })
      status = 'faite'
    } catch (e: any) { status = 'echec'; error = String(e?.message || e).slice(0, 500) }
    await sb.from('assistant_actions').update({ status, result, error }).eq('id', a.id)
  }
  const note = status === 'faite' ? `⚙️ ${auth.user.name} a CONFIRMÉ « ${label} » — fait.` : status === 'echec' ? `⚙️ ${auth.user.name} a confirmé « ${label} » mais VD Soft a refusé : ${error}` : `⚙️ ${auth.user.name} a ANNULÉ « ${label} » — rien n'a été modifié.`
  await sb.from('assistant_messages').insert({ conversation_id: a.conversation_id, role: 'user', content: { type: 'text', text: note } })
  await sb.from('assistant_conversations').update({ updated_at: now }).eq('id', a.conversation_id)
  return NextResponse.json({ ok: status !== 'echec', status, error, note })
}
