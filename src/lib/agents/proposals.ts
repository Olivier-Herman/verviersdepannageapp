// src/lib/agents/proposals.ts
//
// File de propositions des agents (lot 1, Olivier 05/10/2026) : dépôt par
// l'agent, validation / refus / correction par une personne, exécution par
// VD Soft. Trace complète : qui a préparé, qui a validé, quand, résultat.

import { createAdminClient } from '@/lib/supabase'
import { type AgentAccount, type ProposalKind, ALL_KINDS, KIND_LABEL, COMPANY_LABEL, checkCompany, isNight, journal } from './core'
import { prepare, execute } from './execute'

export interface Actor { id: string; name: string; isSuperadmin: boolean }

/** Dépôt d'une proposition. Exécutée tout de suite si l'envoi direct est permis. */
export async function submitProposal(agent: AgentAccount, body: any): Promise<{ id: string; status: string; note?: string; error?: string }> {
  const sb = createAdminClient()
  const kind = String(body?.type || '') as ProposalKind
  if (!ALL_KINDS.includes(kind)) throw new Error(`type inconnu. Types : ${ALL_KINDS.join(', ')}.`)
  if (!agent.kinds.includes(kind)) {
    await journal({ agent: agent.name, action: 'proposition refusée', detail: `type « ${kind} » hors de ses droits`, ok: false })
    throw new Error(`Vous ne pouvez pas proposer « ${KIND_LABEL[kind]} ».`)
  }
  const co = checkCompany(agent, body?.societe)
  if (!co.ok) { await journal({ agent: agent.name, company: Number(body?.societe) || null, action: 'proposition refusée', detail: co.error, ok: false }); throw new Error(co.error) }
  const why = String(body?.pourquoi || '').trim().slice(0, 2000)
  if (!why) throw new Error('pourquoi obligatoire : ce que vous avez vérifié et pourquoi vous le proposez.')

  const prep = await prepare(kind, agent, co.company, body)
  // Une seule question par facture (garde-fou validé par Olivier le 05/10/2026).
  if (kind === 'question_olivier') {
    const { data: twin } = await sb.from('agent_proposals').select('id, status').eq('kind', 'question_olivier').eq('company_id', co.company)
      .eq('payload->>facture_id', String(prep.payload.facture_id)).in('status', ['to_validate', 'answered']).limit(1).maybeSingle()
    if (twin) throw new Error(`Question déjà posée pour cette facture (${twin.status === 'answered' ? 'réponse disponible' : 'en attente de réponse'}).`)
  }
  // Envoi direct : permis à cet agent, permis par la règle métier, et jamais la
  // nuit — sauf les notes de crédit / refacturations certaines d'Élodie.
  const night = isNight()
  const wantsDirect = agent.direct_kinds.includes(kind) && prep.directAllowed
  const direct = wantsDirect && (!night || kind === 'note_credit')
  const nightNote = wantsDirect && !direct ? 'Nuit (18 h–6 h) : rien ne part, proposition mise en attente de validation.' : undefined

  const { data: row, error } = await sb.from('agent_proposals').insert({
    agent_id: agent.id, agent_name: agent.name, company_id: co.company, kind, title: `${KIND_LABEL[kind]} · ${prep.title}`.slice(0, 300),
    why, amount: prep.amount, payload: { ...prep.payload, ...(prep.directWhy ? { envoi_direct: prep.directWhy } : {}) }, certain: body?.certain === true, direct,
    status: direct ? 'executing' : 'to_validate', validator_user_id: agent.validator_user_id,
  }).select('id').single()
  if (error || !row) throw new Error(error?.message || 'Dépôt impossible')
  await journal({ agent: agent.name, company: co.company, action: direct ? 'envoi direct' : 'proposition', detail: `${KIND_LABEL[kind]} · ${prep.title}${nightNote ? ' · ' + nightNote : ''}`, proposalId: row.id })
  if (kind === 'question_olivier') {
    const { data: full } = await sb.from('agent_proposals').select('*').eq('id', row.id).single()
    const { sendQuestion } = await import('./question')
    const n = await sendQuestion(full).catch(() => 0)
    return { id: row.id, status: 'to_validate', note: n ? `Question envoyée sur Telegram (${n} destinataire${n > 1 ? 's' : ''}).` : 'Question visible dans l’écran « Propositions des agents » (aucun Telegram relié pour l’instant).' }
  }
  if (!direct) return { id: row.id, status: 'to_validate', note: nightNote }
  return runExecution(row.id, `${agent.name} (envoi direct)`)
}

/** Exécute une proposition (envoi direct ou après validation). */
async function runExecution(id: string, by: string): Promise<{ id: string; status: string; note?: string; error?: string }> {
  const sb = createAdminClient()
  const { data: p } = await sb.from('agent_proposals').select('*').eq('id', id).single()
  const now = new Date().toISOString()
  try {
    const result = await execute(p.kind, p.company_id, p.payload)
    await sb.from('agent_proposals').update({ status: 'executed', result, error: null, executed_at: now, updated_at: now }).eq('id', id)
    await journal({ agent: p.agent_name, company: p.company_id, action: 'exécutée', detail: result.note, proposalId: id, actor: by })
    return { id, status: 'executed', note: result.note }
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 800)
    await sb.from('agent_proposals').update({ status: 'failed', error: msg, updated_at: now }).eq('id', id)
    await journal({ agent: p.agent_name, company: p.company_id, action: 'échec', detail: msg, ok: false, proposalId: id, actor: by })
    return { id, status: 'failed', error: msg }
  }
}

function canDecide(p: any, actor: Actor): boolean {
  return actor.isSuperadmin || (p.validator_user_id && p.validator_user_id === actor.id)
}

/** Décision d'une personne : valider, refuser, renvoyer pour correction. */
export async function decideProposal(id: string, actor: Actor, action: 'valider' | 'refuser' | 'corriger', text?: string) {
  const sb = createAdminClient()
  const { data: p } = await sb.from('agent_proposals').select('*').eq('id', id).maybeSingle()
  if (!p) throw new Error('Proposition introuvable')
  if (p.kind === 'question_olivier') throw new Error('Une question se règle avec ses deux boutons de réponse.')
  if (!canDecide(p, actor)) throw new Error('Vous n’êtes pas la personne désignée pour valider les propositions de cet agent.')
  const now = new Date().toISOString()
  const open = p.status === 'to_validate' || p.status === 'failed'
  if (!open) throw new Error('Proposition déjà traitée.')
  if (action === 'refuser' || action === 'corriger') {
    const t = String(text || '').trim().slice(0, 1000)
    if (!t) throw new Error(action === 'refuser' ? 'Motif du refus obligatoire.' : 'Dites ce qu’il faut changer.')
    await sb.from('agent_proposals').update({
      status: action === 'refuser' ? 'refused' : 'returned', [action === 'refuser' ? 'refused_reason' : 'correction']: t,
      validated_by: actor.name, validated_at: now, updated_at: now,
    }).eq('id', id)
    await journal({ agent: p.agent_name, company: p.company_id, action: action === 'refuser' ? 'refusée' : 'renvoyée pour correction', detail: t, proposalId: id, actor: actor.name })
    return { id, status: action === 'refuser' ? 'refused' : 'returned' }
  }
  // Verrou : un double clic ne lance pas deux exécutions.
  const { data: locked } = await sb.from('agent_proposals').update({ status: 'executing', validated_by: actor.name, validated_at: now, updated_at: now }).eq('id', id).in('status', ['to_validate', 'failed']).select('id')
  if (!locked?.length) throw new Error('Proposition déjà en cours d’exécution.')
  await journal({ agent: p.agent_name, company: p.company_id, action: p.status === 'failed' ? 'nouvel essai' : 'validée', proposalId: id, actor: actor.name })
  return runExecution(id, actor.name)
}

export { COMPANY_LABEL, KIND_LABEL }
