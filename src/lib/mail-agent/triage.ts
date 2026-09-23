// src/lib/mail-agent/triage.ts
//
// TRIAGE QUOTIDIEN (Olivier 23/09/2026, jour 1) : « un module pour tous les
// jours avoir ce système qui analyse les mails des boîtes et demande ce qu'on
// doit faire, puis que ça soit automatisé, avec un affichage de décision aussi
// clair que l'artefact ».
//
// Tout mail nouveau d'info@ / administration@ qui n'est ni un rejet, ni une
// facture fournisseur, ni du bruit, ni une mission d'assisteur, est classé par
// Claude dans une FAMILLE, résumé en deux phrases, puis enrichi avec ce que
// l'on sait déjà : nos factures citées (Odoo) et les plaques citées (VD Soft).
// L'item (handler 'triage', status 'to_decide') porte des PROPOSITIONS
// d'action : au jour 1 seules « Laisser », « Fait ailleurs » et « Classer »
// s'exécutent ; les autres s'affichent et arrivent au jour 2.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { odooRpc } from '@/lib/odoo'
import { getMessageText, type AgentMessage } from './graph'

export const FAMILIES: Record<string, string> = {
  demande_avoir:     'Demande de note de crédit',
  demande_document:  'Demande de facture ou de document',
  double_paiement:   'Double paiement / remboursement',
  rappel_paiement:   'Rappel de paiement reçu',
  question_compta:   'Question comptable',
  reclamation:       'Réclamation client',
  contestation:      'Contestation de facture',
  info:              'Information, rien à faire',
  autre:             'Autre',
}

// Propositions par famille. `ready` = exécutable (jour 2 : toutes).
export const PROPOSALS: Record<string, { key: string; label: string; ready: boolean }[]> = {
  demande_avoir:    [{ key: 'avoir', label: 'Créer l\'avoir et répondre', ready: true }, { key: 'contester', label: 'Contester', ready: true }],
  demande_document: [{ key: 'envoyer_doc', label: 'Envoyer le document demandé', ready: true }, { key: 'repondre', label: 'Répondre', ready: true }],
  double_paiement:  [{ key: 'rembourser', label: 'Confirmer le remboursement', ready: true }],
  rappel_paiement:  [{ key: 'encoder', label: 'Transférer pour encodage', ready: true }, { key: 'repondre_paye', label: 'Répondre : déjà payé', ready: true }],
  question_compta:  [{ key: 'brouillon', label: 'Préparer un brouillon de réponse', ready: true }],
  reclamation:      [{ key: 'brouillon', label: 'Préparer un brouillon de réponse', ready: true }],
  contestation:     [{ key: 'brouillon', label: 'Préparer un brouillon de réponse', ready: true }, { key: 'avoir', label: 'Créer l\'avoir', ready: true }],
  info:             [],
  autre:            [],
}
export const COMMON_PROPOSALS = [
  { key: 'classer', label: 'Classer', ready: true },
  { key: 'fait_ailleurs', label: 'Fait ailleurs', ready: true },
  { key: 'laisser', label: 'Laisser', ready: true },
]
/** Dossiers de classement proposés au clic « Classer ». */
export const FILE_FOLDERS = ['0 - Jona et Mobi', 'Fournisseur Divers', 'Mail auto-géré', 'clients divers', 'comptable thg']

const NOISE_FROM = /no-?reply@kaze|circlekeur|scrada\.be|mailer-daemon|postmaster|noreply@(google|microsoft|linkedin|facebook|apple)|calendar-notification|notifications@github|no-reply@accounts|newsletter|marketing@|info@scrada|loyaltek|ticket@|aprovall|verviersdepannage\.(be|com)|towsoft\.ca|lemans\.org/i
const NOISE_SUBJECT = /^(accepté|accepted|refusé|declined|annulé|canceled|invitation|réunion|meeting)\s*:|undeliverable|non remis|out of office|absence du bureau|automatic reply|réponse automatique|CODA livre de caisse|Anomalies FleetCards|Fichier de Facturation \(TID\)|A new note was added|EMAIL TICKET|Towing Report|Confirmation d'intervention|Interventie goedgekeurd|^Mail IMA -|PRISE EN CHARGE|INTER PARTNER ASSISTANCE|🚫|Mal Garée —|Caisse Agent|clefs dans le digi/i
// Ordres de mission d'assisteurs : l'intake s'en charge déjà.
const MISSION_FROM = /imabenelux|ima\.eu|kaze\.so|touring\.be|vab\.be|allianz|awp|axa|eurocross|europ-assistance|ethias|hexalite|comex|anwb|ipa/i
const MISSION_SUBJECT = /demande d'intervention|assignation|mission|dossier n°|opdracht|intervention n°/i

export function isNoise(msg: AgentMessage): boolean {
  return NOISE_FROM.test(msg.fromEmail || '') || NOISE_SUBJECT.test(msg.subject || '')
}
/** Un assisteur qui écrit sans parler de facture/avoir/paiement = un ordre de mission (intake). */
export function isAssistanceMission(msg: AgentMessage, folder = ''): boolean {
  if (/mission|encaissements chauffeur|paiement chauffeur|ticket bancontact|spam/i.test(folder)) return true
  if (!MISSION_FROM.test(msg.fromEmail || '')) return false
  return !/facture|invoice|factuur|note de cr|creditnota|paiement|payment|rappel|reminder|rejet|afwijzing/i.test(msg.subject || '')
}
void MISSION_SUBJECT

let _client: Anthropic | null = null
const client = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))
const OUR_INVOICE_RE = /\b(20\d{2}\/\d{2}\/\d{3,4})\b/g
const PLATE_RE = /\b([1-9][A-Z]{3}\d{3}|[A-Z]{3}\d{3}|\d{1,3}[A-Z]{3}\d{1,3}|[A-Z]{2}\d{3}[A-Z]{2})\b/g

const PROMPT = `Tu tries le courrier administratif d'une société belge de dépannage (Verviers Dépannage). Voici un mail reçu. Réponds STRICTEMENT en JSON :
{"family":"<une des clés : demande_avoir, demande_document, double_paiement, rappel_paiement, question_compta, reclamation, contestation, info, autre>",
 "summary":"<2 phrases en français : qui écrit, ce qu'il demande ou signale, avec les références citées>",
 "asked":"<en une ligne : ce que l'expéditeur attend de nous, ou null>",
 "invoice_numbers":["<nos numéros de facture cités, format AAAA/MM/NNN>"],
 "plates":["<plaques d'immatriculation citées, sans espaces>"],
 "amount":<montant principal en euros ou null>,
 "urgent":<true si relance, mise en demeure ou délai court>}
N'invente rien. Si le mail ne demande rien (information, confirmation), family = "info".`

export interface TriageResult {
  family: string; summary: string; asked: string | null; invoice_numbers: string[]; plates: string[]; amount: number | null; urgent: boolean
  facts: { invoices: any[]; fiches: any[] }
  proposals: { key: string; label: string; ready: boolean }[]
}

/** Même fil déjà en attente (info@ et administration@ reçoivent souvent le même mail) ? */
export async function twinInQueue(sb: any, msg: AgentMessage): Promise<{ id: string; mailbox: string } | null> {
  const norm = String(msg.subject || '').replace(/^\s*((re|tr|fw|fwd|aw|wg)\s*:\s*)+/i, '').trim().toLowerCase()
  if (!norm) return null
  const since = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data } = await sb.from('mail_agent_items').select('id, mailbox, subject').eq('handler', 'triage').eq('from_email', msg.fromEmail).eq('status', 'to_decide').neq('message_id', msg.id).gte('received_at', since).limit(20)
  for (const d of data || []) if (String(d.subject || '').replace(/^\s*((re|tr|fw|fwd|aw|wg)\s*:\s*)+/i, '').trim().toLowerCase() === norm) return { id: d.id, mailbox: d.mailbox }
  return null
}

export async function triageMail(sb: any, mailbox: string, msg: AgentMessage): Promise<TriageResult | null> {
  const text = (await getMessageText(mailbox, msg.id)).slice(0, 7000)
  const r = await client().messages.create({ model: ANTHROPIC_MODEL, max_tokens: 700, messages: [{ role: 'user', content: `${PROMPT}\n\nDe : ${msg.fromName || ''} <${msg.fromEmail}>\nObjet : ${msg.subject}\nReçu : ${msg.receivedAt}\n\n${text}` }] })
  const raw = (r.content[0] as any)?.text || ''
  const m = raw.match(/\{[\s\S]*\}/); let j: any = null
  try { j = m ? JSON.parse(m[0]) : null } catch { j = null }
  if (!j || !j.family) return null
  const family = FAMILIES[j.family] ? j.family : 'autre'
  // Références : celles de Claude + celles trouvées par regex dans le mail.
  const hay = `${msg.subject}\n${text}`
  const invoiceNumbers = Array.from(new Set([...(Array.isArray(j.invoice_numbers) ? j.invoice_numbers : []), ...Array.from(hay.matchAll(OUR_INVOICE_RE)).map(x => x[1])].map(s => String(s).trim()).filter(s => /^20\d{2}\/\d{2}\/\d{3,4}$/.test(s)))).slice(0, 6)
  const plates = Array.from(new Set([...(Array.isArray(j.plates) ? j.plates : []), ...Array.from(hay.toUpperCase().matchAll(PLATE_RE)).map(x => x[1])].map(s => String(s).replace(/[\s-]/g, '').toUpperCase()).filter(s => s.length >= 5 && s.length <= 9))).slice(0, 6)
  // Faits : Odoo pour nos factures, VD Soft pour les plaques.
  const invoices: any[] = []
  if (invoiceNumbers.length) {
    try {
      const inv: any[] = await odooRpc('account.move', 'search_read', [[['move_type', 'in', ['out_invoice', 'out_refund']], ['name', 'in', invoiceNumbers]]], { fields: ['id', 'name', 'state', 'payment_state', 'amount_total', 'partner_id', 'invoice_date', 'x_studio_plaque_1', 'reversal_move_ids'], limit: 10 }) || []
      for (const i of inv) invoices.push({ id: i.id, name: i.name, state: i.state, payment_state: i.payment_state, amount_total: i.amount_total, partner: i.partner_id?.[1] || null, date: i.invoice_date, plate: String(i.x_studio_plaque_1 || '').split('/').pop() || null, has_credit_note: (i.reversal_move_ids || []).length > 0 })
      for (const n of invoiceNumbers) if (!inv.some((i: any) => i.name === n)) invoices.push({ name: n, missing: true })
    } catch {}
  }
  const fiches: any[] = []
  for (const p of plates) {
    try {
      const { data } = await sb.from('incoming_missions').select('id, mission_number, status, source, mission_type, received_at, invoice_number, billed_to_name, client_name').ilike('vehicle_plate', `%${p}%`).eq('dossier_leg', false).order('received_at', { ascending: false }).limit(3)
      for (const f of data || []) fiches.push({ plate: p, id: f.id, number: f.mission_number, status: f.status, source: f.source, type: f.mission_type, at: f.received_at, invoice: f.invoice_number, billed_to: f.billed_to_name, client: f.client_name })
    } catch {}
  }
  return {
    family, summary: String(j.summary || '').slice(0, 600), asked: j.asked ? String(j.asked).slice(0, 200) : null,
    invoice_numbers: invoiceNumbers, plates, amount: typeof j.amount === 'number' ? j.amount : null, urgent: Boolean(j.urgent),
    facts: { invoices, fiches },
    proposals: [...(PROPOSALS[family] || []), ...COMMON_PROPOSALS],
  }
}

// ── Automatisation par famille (jour 3) ─────────────────────────────────────
// Réglage `mail_agent_auto` = { famille: action | null }. Une famille en
// automatique voit son action exécutée dès le triage (avec le mode draft/auto
// courant), sans clic. Suggestion : dix décisions humaines identiques sur une
// famille → l'écran propose de passer en automatique.
export async function readAutoFamilies(sb: any): Promise<Record<string, string | null>> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'mail_agent_auto').maybeSingle()
  try { const v = data?.value ? JSON.parse(data.value) : {}; return v && typeof v === 'object' ? v : {} } catch { return {} }
}
export async function autoStats(sb: any): Promise<Record<string, { action: string; count: number }[]>> {
  const { data } = await sb.from('mail_agent_items').select('extracted').eq('handler', 'triage').eq('status', 'decided').limit(2000)
  const acc: Record<string, Record<string, number>> = {}
  for (const it of data || []) {
    const x: any = it.extracted || {}; const f = x.family, a = x.decision?.action
    if (!f || !a || x.decision?.by === 'agent' || a === 'laisser' || a === 'fait_ailleurs') continue
    ;(acc[f] ||= {})[a] = ((acc[f] || {})[a] || 0) + 1
  }
  const out: Record<string, { action: string; count: number }[]> = {}
  for (const [f, m] of Object.entries(acc)) out[f] = Object.entries(m).map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count)
  return out
}
