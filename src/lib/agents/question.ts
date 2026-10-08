// src/lib/agents/question.ts
//
// Question d'un agent à Olivier (Olivier 05/10/2026) : ex. facture d'achat au
// nom privé d'une personne. Envoyée sur Telegram (bot de VD Soft) aux
// validateurs reliés — le validateur désigné de l'agent, sinon les superadmins —
// avec deux boutons. La réponse est enregistrée sur la proposition (qui, quand,
// quel choix) et revient à l'agent par GET /api/agents/propositions. On peut
// aussi répondre depuis l'écran « Propositions des agents ».

import { createAdminClient } from '@/lib/supabase'
import { tgSend } from '@/lib/sam/telegram'
import { COMPANY_LABEL, journal } from './core'

export const ANSWERS: Record<string, { key: string; label: string }[]> = {
  facture_nom_prive: [{ key: 'encoder', label: 'Encoder chez VD' }, { key: 'prive', label: 'Privé, ne pas encoder' }],
}

/** Réponses possibles d'une question : fixes par sujet, ou proposées par l'agent pour une question libre,
 *  toujours complétées par « Déjà réglé » (Olivier 08/10/2026 : « je ne sais rien répondre à ça »). */
export const DEJA_REGLE = { key: 'deja_regle', label: 'Déjà réglé' }
export function answersFor(payload: any): { key: string; label: string }[] {
  if (payload?.sujet === 'libre') return [...(Array.isArray(payload.choix) ? payload.choix : []), DEJA_REGLE]
  return ANSWERS[payload?.sujet] || []
}

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com').replace(/\/$/, '')

/** Comptes qui peuvent répondre : le validateur désigné de l'agent, sinon les superadmins actifs. */
export async function answererIds(validatorUserId: string | null): Promise<string[]> {
  const sb = createAdminClient()
  if (validatorUserId) return [validatorUserId]
  const { data } = await sb.from('users').select('id').or('role.eq.superadmin,roles.ov.{superadmin}').eq('active', true)
  return (data || []).map(u => u.id)
}

/** Envoie la question sur Telegram. Renvoie le nombre de destinataires atteints. */
export async function sendQuestion(p: any): Promise<number> {
  const sb = createAdminClient()
  const ids = await answererIds(p.validator_user_id)
  const { data: links } = await sb.from('telegram_links').select('chat_id, user_id').in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  if (!links?.length) return 0
  const x = p.payload || {}
  const eur = (n: any) => n == null ? '?' : Number(n).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
  const text = x.sujet === 'libre' ? [
    `Question de ${p.agent_name} · ${COMPANY_LABEL[p.company_id] || p.company_id}`,
    x.question,
    x.contexte ? `\n${x.contexte}` : '',
    x.choix?.length ? '' : '\nRéponds avec tes mots dans VD Soft, « Propositions des agents ».',
  ].filter(Boolean).join('\n') : [
    `Facture au nom privé · ${COMPANY_LABEL[p.company_id] || p.company_id}`,
    `${x.fournisseur} · ${x.reference || 'sans référence'} · ${x.date || 'sans date'}`,
    `Destinataire : ${x.destinataire}`,
    ...(x.lignes || []).slice(0, 5),
    `${eur(x.htva)} HTVA / ${eur(x.tvac)} TVAC`,
    x.mail ? `Mail d'origine : ${x.mail.de} · « ${x.mail.objet || ''} » · ${String(x.mail.date || '').slice(0, 10)}` : 'Pas de mail d’origine (arrivée par Peppol, scan ou VD Soft).',
    p.why ? `${p.agent_name} : ${p.why}` : '',
  ].filter(Boolean).join('\n')
  const odoo = process.env.ODOO_URL ? `${process.env.ODOO_URL.replace(/\/$/, '')}/odoo/action-account.action_move_in_invoice_type/${x.facture_id}` : null
  const rows: Array<Array<{ text: string; data?: string; url?: string }>> = [
    answersFor(x).map(a => ({ text: a.label, data: `aq:${p.id}:${a.key}` })),
    [{ text: 'Voir dans VD Soft', url: `${APP_URL()}/admin/agents` }, ...(odoo ? [{ text: 'Ouvrir dans Odoo', url: odoo }] : [])],
  ]
  let sent = 0
  for (const l of links) { try { await tgSend(Number(l.chat_id), text, rows, p.agent_name); sent++ } catch { /* un échec n'empêche pas les autres */ } }
  return sent
}

/** Enregistre la réponse (une seule fois). */
export async function answerAgentQuestion(id: string, userId: string, userName: string, key: string, canal: 'telegram' | 'ecran', texte?: string): Promise<{ ok: boolean; note: string }> {
  const sb = createAdminClient()
  const { data: p } = await sb.from('agent_proposals').select('*').eq('id', id).maybeSingle()
  if (!p || p.kind !== 'question_olivier') return { ok: false, note: 'Question introuvable.' }
  const allowed = await answererIds(p.validator_user_id)
  if (!allowed.includes(userId)) return { ok: false, note: 'Cette question ne t’est pas adressée.' }
  // Réponse libre (écran) : le texte d'Olivier devient la réponse.
  const libre = key === 'libre' ? String(texte || '').trim().slice(0, 2000) : ''
  if (key === 'libre' && (!libre || p.payload?.sujet !== 'libre')) return { ok: false, note: 'Réponse vide.' }
  const a = libre ? { key: 'libre', label: libre } : answersFor(p.payload).find(x => x.key === key)
  if (!a) return { ok: false, note: 'Réponse inconnue.' }
  if (p.status !== 'to_validate') return { ok: false, note: `Déjà répondu : ${p.result?.label || '?'} (${p.validated_by || '?'}).` }
  const now = new Date().toISOString()
  const { data: done } = await sb.from('agent_proposals').update({ status: 'answered', result: { choix: a.key, label: a.label, canal }, validated_by: userName, validated_at: now, updated_at: now })
    .eq('id', id).eq('status', 'to_validate').select('id')
  if (!done?.length) return { ok: false, note: 'Déjà répondu.' }
  await journal({ agent: p.agent_name, company: p.company_id, action: 'question répondue', detail: `${p.title} → ${a.label} (${canal})`, proposalId: id, actor: userName })
  return { ok: true, note: `Noté : « ${a.label} ». ${p.agent_name} en est informé.` }
}
