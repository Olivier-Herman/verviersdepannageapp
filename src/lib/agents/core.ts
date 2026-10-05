// src/lib/agents/core.ts
//
// Agents HOOS dédiés à VD — lot 1 (Olivier 05/10/2026, « OK lot 1 ») :
// l'agent PRÉPARE, une personne VALIDE, VD Soft EXÉCUTE avec le compte de l'app
// (décision A2), la société étant visée explicitement à chaque appel.
//   - Chaque agent a sa clé (hachée en base), ses sociétés, ses types de
//     proposition et ses envois directs (table agent_accounts).
//   - Tout appel hors de ses droits est refusé et journalisé (agent_journal).
//   - Garde-fou de nuit (18 h–6 h, heure de Bruxelles) : aucune exécution
//     directe, sauf les notes de crédit / refacturations qu'Élodie déclare
//     certaines (seule exception, Olivier 05/10/2026).

import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase'

export type ProposalKind = 'lot_paiement' | 'facture_achat' | 'note_credit' | 'envoi_comptable' | 'question_olivier' | 'rapprochement_bouton' | 'rapprochement_banque' | 'plaque_achat' | 'annulation_doublon' | 'ticket_achat' | 'refacturation_avance'
export const KIND_LABEL: Record<ProposalKind, string> = {
  lot_paiement:    'Lot de paiement fournisseurs',
  facture_achat:   'Valider une facture d’achat',
  note_credit:     'Note de crédit et refacturation',
  envoi_comptable: 'Pièces envoyées au comptable',
  question_olivier: 'Question à Mobi',
  rapprochement_bouton: 'Rapprochement au bouton (Paynovate, SumUp, assureurs)',
  rapprochement_banque: 'Rapprochement d’une ligne de banque',
  plaque_achat:     'Plaque sur une facture d’achat',
  annulation_doublon: 'Brouillon en double annulé (mail + Peppol)',
  ticket_achat:     'Ticket de caisse encodé',
  refacturation_avance: 'Refacturation d’une avance de fonds',
}
export const ALL_KINDS = Object.keys(KIND_LABEL) as ProposalKind[]
export const COMPANY_LABEL: Record<number, string> = { 1: 'Verviers Dépannage', 2: 'Dépannage Riga', 3: 'DGJ VHU' }

export interface AgentAccount {
  id: string; name: string; role_label: string | null; companies: number[]; kinds: string[]; direct_kinds: string[]
  validator_user_id: string | null; active: boolean
}

export const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex')

/** Nouvelle clé d'agent : affichée une seule fois, seule son empreinte est gardée. */
export function newAgentKey(): { key: string; hash: string; prefix: string } {
  const key = `vda_${crypto.randomBytes(24).toString('base64url')}`
  return { key, hash: hashKey(key), prefix: key.slice(0, 8) }
}

/** Agent authentifié par « Authorization: Bearer <clé> », sinon null. */
export async function authenticateAgent(req: Request): Promise<AgentAccount | null> {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(vda_[A-Za-z0-9_-]{20,})$/)
  if (!m) return null
  const { data } = await createAdminClient().from('agent_accounts')
    .select('id, name, role_label, companies, kinds, direct_kinds, validator_user_id, active')
    .eq('key_hash', hashKey(m[1])).maybeSingle()
  return data && data.active ? data as AgentAccount : null
}

export async function journal(e: { agent?: string | null; company?: number | null; action: string; detail?: string; ok?: boolean; proposalId?: string | null; actor?: string | null }) {
  try {
    await createAdminClient().from('agent_journal').insert({
      agent_name: e.agent || null, company_id: e.company ?? null, action: e.action, detail: e.detail?.slice(0, 1000) || null,
      ok: e.ok !== false, proposal_id: e.proposalId || null, actor: e.actor || null,
    })
  } catch { /* le journal ne bloque jamais l'action */ }
}

/** Heure de Bruxelles : la nuit va de 18 h à 6 h (équipe de nuit, Olivier 04/10/2026). */
export function isNight(d = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(d)) % 24
  return h >= 18 || h < 6
}

/** Société demandée, validée contre les droits de l'agent. */
export function checkCompany(agent: AgentAccount, raw: unknown): { ok: true; company: number } | { ok: false; error: string } {
  const company = Number(raw)
  if (!Number.isInteger(company) || !(company in COMPANY_LABEL)) return { ok: false, error: 'Société obligatoire : societe=1 (Verviers Dépannage), 2 (Dépannage Riga) ou 3 (DGJ VHU).' }
  if (!agent.companies.includes(company)) return { ok: false, error: `Société hors de vos droits (${COMPANY_LABEL[company]}).` }
  return { ok: true, company }
}
