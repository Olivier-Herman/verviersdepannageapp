// src/lib/mail-agent/handlers/fournisseur.ts
//
// FACTURES FOURNISSEURS (Olivier 23/09/2026) : « si tu vois des factures
// fournisseurs, tu dois vérifier si c'est pour Verviers Dépannage ou pour
// Dépannage Riga, vérifier si elles sont déjà dans Odoo ; si oui tu déplaces le
// mail dans « Fournisseur Divers » ; si la facture n'est pas encore dans Odoo,
// il faut l'envoyer pour encodage. » Odoo est multi-sociétés : Verviers
// Dépannage = 1, Dépannage Riga = 2, DGJ VHU = 3, chacune avec sa boîte
// d'encodage (alias du journal d'achats).
//
// Ce handler n'est PAS un rejet : pas d'avoir, pas de refacturation. Il lit le
// PDF, décide, classe. Tout est tracé dans mail_agent_items (handler
// 'fournisseur') et un même numéro de facture n'est jamais traité deux fois.

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL } from '@/lib/anthropic-model'
import { odooRpc } from '@/lib/odoo'
import { getPdfAttachments, getMessageText, findFolderIdByName, moveMessage, forwardMessage, type AgentMessage } from '../graph'

export const FOURNISSEUR_DONE_FOLDER = 'Fournisseur Divers'

export const COMPANIES = {
  vd:   { id: 1, label: 'Verviers Dépannage', vat: 'BE0460759205', alias: 'purchases@verviers-depannage.odoo.com' },
  riga: { id: 2, label: 'Dépannage Riga',     vat: 'BE0890464750', alias: 'purchases-depannage-riga@verviers-depannage.odoo.com' },
  dgj:  { id: 3, label: 'DGJ VHU',            vat: 'BE0731879153', alias: 'purchases-dgj.vhu@verviers-depannage.odoo.com' },
} as const
export type CompanyKey = keyof typeof COMPANIES

// Expéditeurs qui ne sont jamais des fournisseurs : assisteurs (leurs mails
// « facture » sont des demandes, pas des factures à encoder) et nos boîtes.
const NOT_SUPPLIER = /touring\.be|vab\.be|allianz|awp|imabenelux|ima\.eu|axa|ethias|kaze\.so|eurocross|europ-assistance|verviersdepannage|just\.fgov|police|comex/i
const INVOICE_SUBJECT = /facture|invoice|factuur|rechnung|rappel|reminder|herinnering/i

/** Candidat « facture fournisseur » : une PJ, un sujet de facture, pas un assisteur. */
export function isSupplierCandidate(msg: AgentMessage): boolean {
  if (!msg.hasAttachments) return false
  if (NOT_SUPPLIER.test(msg.fromEmail)) return false
  return INVOICE_SUBJECT.test(msg.subject || '')
}

export interface SupplierExtraction {
  supplier: string | null; invoice_number: string | null; invoice_date: string | null; total: number | null
  addressee: string | null; addressee_vat: string | null; is_reminder: boolean
}
const PROMPT = `Tu lis un document reçu par une société de dépannage belge. Si c'est une facture (ou un rappel de facture) d'un fournisseur, réponds STRICTEMENT en JSON :
{"supplier":"<nom du fournisseur émetteur>","invoice_number":"<numéro de facture exact>","invoice_date":"<AAAA-MM-JJ ou null>","total":<montant TTC en euros ou null>,"addressee":"<nom exact de la société destinataire tel qu'écrit>","addressee_vat":"<TVA du destinataire sans espaces ni points, ou null>","is_reminder":<true si c'est un rappel/relance, sinon false>}
Si ce n'est PAS une facture fournisseur (bon de commande, devis, note de crédit reçue, publicité…), réponds {"not_invoice": true}. N'invente rien : null si absent.`

let _client: Anthropic | null = null
const client = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))
const parseJson = (txt: string) => { const m = txt.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null } catch { return null } }

export async function extractSupplierInvoice(mailbox: string, msg: AgentMessage): Promise<SupplierExtraction | 'not_invoice' | null> {
  const pdfs = await getPdfAttachments(mailbox, msg.id)
  let parsed: any = null
  if (pdfs.length) {
    const r = await client().messages.create({ model: ANTHROPIC_MODEL, max_tokens: 600, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfs[0].base64 } }, { type: 'text', text: PROMPT }] }] })
    parsed = parseJson((r.content[0] as any)?.text || '')
  } else {
    const text = await getMessageText(mailbox, msg.id)
    const r = await client().messages.create({ model: ANTHROPIC_MODEL, max_tokens: 600, messages: [{ role: 'user', content: `${PROMPT}\n\nTexte du mail :\n${text.slice(0, 6000)}` }] })
    parsed = parseJson((r.content[0] as any)?.text || '')
  }
  if (!parsed) return null
  if (parsed.not_invoice) return 'not_invoice'
  if (!parsed.invoice_number && !parsed.total) return null
  return {
    supplier: parsed.supplier ? String(parsed.supplier).slice(0, 120) : null,
    invoice_number: parsed.invoice_number ? String(parsed.invoice_number).trim().slice(0, 60) : null,
    invoice_date: parsed.invoice_date || null,
    total: typeof parsed.total === 'number' && Number.isFinite(parsed.total) ? parsed.total : null,
    addressee: parsed.addressee ? String(parsed.addressee).slice(0, 120) : null,
    addressee_vat: parsed.addressee_vat ? String(parsed.addressee_vat).replace(/[\s.]/g, '').toUpperCase() : null,
    is_reminder: Boolean(parsed.is_reminder),
  }
}

/** Société destinataire : la TVA fait foi, sinon le nom. */
export function companyOf(x: SupplierExtraction): CompanyKey | null {
  const vat = x.addressee_vat || ''
  for (const [k, c] of Object.entries(COMPANIES)) if (vat && vat === c.vat) return k as CompanyKey
  const a = (x.addressee || '').toLowerCase()
  if (/riga/.test(a)) return 'riga'
  if (/dgj|vhu/.test(a) && !/verviers/.test(a)) return 'dgj'
  if (/verviers\s*d[ée]pannage/.test(a)) return 'vd'
  return null
}

/** La facture est-elle déjà dans Odoo pour cette société ? (numéro, sinon fournisseur + montant) */
export async function findVendorBill(company: CompanyKey, x: SupplierExtraction): Promise<{ name: string; ref: string | null; payment_state: string | null } | null> {
  const ctx = { allowed_company_ids: [1, 2, 3] }
  const fields = ['name', 'ref', 'payment_state']
  const cid = COMPANIES[company].id
  if (x.invoice_number) {
    const num = x.invoice_number.replace(/[^A-Za-z0-9\/\-\.]/g, '')
    if (num.length >= 3) {
      const r: any[] = await odooRpc('account.move', 'search_read', [[['move_type', 'in', ['in_invoice', 'in_refund']], ['company_id', '=', cid], '|', ['ref', 'ilike', num], ['payment_reference', 'ilike', num]]], { fields, limit: 1, context: ctx }) || []
      if (r.length) return r[0]
    }
  }
  if (x.total != null && x.supplier) {
    const tok = x.supplier.split(/\s+/).filter(t => t.length >= 4)[0] || x.supplier.slice(0, 6)
    const r: any[] = await odooRpc('account.move', 'search_read', [[['move_type', 'in', ['in_invoice', 'in_refund']], ['company_id', '=', cid], ['partner_id', 'ilike', tok], ['amount_total', '>=', Math.abs(x.total) - 0.02], ['amount_total', '<=', Math.abs(x.total) + 0.02]]], { fields, limit: 1, context: ctx }) || []
    if (r.length) return r[0]
  }
  return null
}

export interface SupplierOutcome { status: 'applied' | 'to_verify' | 'ignored' | 'skipped'; note: string; extracted: any }

/**
 * Traite un mail candidat de bout en bout. Ne lève jamais : l'orchestrateur
 * trace ce qu'il renvoie.
 */
export async function processSupplierMail(sb: any, mailbox: string, msg: AgentMessage, base: Record<string, any>): Promise<SupplierOutcome> {
  const x = await extractSupplierInvoice(mailbox, msg)
  if (x === 'not_invoice') return { status: 'skipped', note: 'pas une facture fournisseur', extracted: null }
  if (!x) return { status: 'to_verify', note: 'Facture fournisseur non lisible automatiquement — lecture humaine requise', extracted: null }
  const company = companyOf(x)
  const extracted: any = { ...x, company: company ? COMPANIES[company].label : null }
  if (!company) return { status: 'to_verify', note: `Destinataire non reconnu : « ${x.addressee || '?'} » — pour quelle société ?`, extracted }
  // Doublon : même fournisseur + même numéro déjà traité.
  if (x.invoice_number) {
    const { data: twin } = await sb.from('mail_agent_items').select('id, status, folder').eq('mailbox', mailbox).eq('handler', 'fournisseur').neq('message_id', msg.id)
      .eq('extracted->>invoice_number', x.invoice_number).in('status', ['applied', 'to_verify']).limit(1).maybeSingle()
    if (twin) {
      const doneId = await findFolderIdByName(mailbox, FOURNISSEUR_DONE_FOLDER)
      if (doneId) await moveMessage(mailbox, msg.id, doneId).catch(() => {})
      return { status: 'ignored', note: `Doublon : la facture ${x.invoice_number} a déjà été traitée (${twin.status}, dossier « ${twin.folder} »).`, extracted: { ...extracted, duplicateOf: twin.id } }
    }
  }
  const bill = await findVendorBill(company, x)
  const doneId = await findFolderIdByName(mailbox, FOURNISSEUR_DONE_FOLDER)
  if (bill) {
    if (doneId) await moveMessage(mailbox, msg.id, doneId).catch(() => {})
    return { status: 'applied', note: `Déjà dans Odoo (${COMPANIES[company].label}) : ${bill.name}${bill.payment_state ? ' · ' + bill.payment_state : ''} → classée dans « ${FOURNISSEUR_DONE_FOLDER} »`, extracted: { ...extracted, odooBill: bill.name } }
  }
  if (x.is_reminder) {
    return { status: 'to_verify', note: `Rappel d'une facture ABSENTE d'Odoo (${COMPANIES[company].label}) : ${x.supplier || '?'} n° ${x.invoice_number || '?'}${x.total != null ? ' · ' + x.total + ' €' : ''} — à encoder et à payer`, extracted }
  }
  const alias = COMPANIES[company].alias
  const fw = await forwardMessage(mailbox, msg.id, alias, `Encodage automatique (agent mail VD Soft) — ${COMPANIES[company].label} · ${x.supplier || ''} n° ${x.invoice_number || ''}`)
  if (!fw.ok) return { status: 'to_verify', note: `Absente d'Odoo, transfert vers ${alias} refusé (${fw.error || '?'})`, extracted }
  if (doneId) await moveMessage(mailbox, msg.id, doneId).catch(() => {})
  return { status: 'applied', note: `Absente d'Odoo → transférée pour encodage à ${alias} (${COMPANIES[company].label}), mail classé dans « ${FOURNISSEUR_DONE_FOLDER} »`, extracted: { ...extracted, forwardedTo: alias } }
}
