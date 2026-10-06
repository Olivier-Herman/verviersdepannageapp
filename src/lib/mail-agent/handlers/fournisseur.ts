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
import { odooRpcCompany } from '@/lib/odoo'
import { getPdfAttachments, getMessageText, findFolderIdByName, moveMessage, forwardMessage, type AgentMessage } from '../graph'
import { aiClient } from '@/lib/ai/usage'

export const FOURNISSEUR_DONE_FOLDER = 'Fournisseur Divers'
/** Dossier de Justine (Riga) dans info@ et administration@ : les factures Riga y
 *  sont rangées après traitement, au lieu de « Fournisseur Divers » (Olivier 05/10/2026). */
export const RIGA_FOLDER = 'Dépannage Riga'

export const COMPANIES = {
  vd:   { id: 1, label: 'Verviers Dépannage', vat: 'BE0460759205', alias: 'purchases@verviers-depannage.odoo.com' },
  riga: { id: 2, label: 'Dépannage Riga',     vat: 'BE0890464750', alias: 'purchases-depannage-riga@verviers-depannage.odoo.com' },
  dgj:  { id: 3, label: 'DGJ VHU',            vat: 'BE0731879153', alias: 'purchases-dgj.vhu@verviers-depannage.odoo.com' },
} as const
export type CompanyKey = keyof typeof COMPANIES

// Expéditeurs qui ne sont jamais des fournisseurs : assisteurs (leurs mails
// « facture » sont des demandes, pas des factures à encoder) et nos boîtes.
export const NOT_SUPPLIER = /touring\.be|vab\.be|allianz|awp|imabenelux|ima\.eu|axa|ethias|kaze\.so|eurocross|europ-assistance|verviers-?depannage|just\.fgov|police|comex/i
// « Nouveau document de … » (BillToBox), « votre facture est disponible »… (Olivier 06/10/2026 :
// une facture qui n'arrive pas par Peppol se prend par mail, quelle que soit la plateforme).
const INVOICE_SUBJECT = /facture|invoice|factuur|rechnung|rappel|reminder|herinnering|nouveau document de|nieuw document van|new document from|document disponible/i
/** Plateformes d'envoi de factures (réglage « mail_factures_plateformes ») : un PDF joint suffit. */
let PLATFORMS: string[] = ['billtobox.be', 'pennylane.com', 'clearfacts.be', 'storecove.com', 'codabox.com', 'einvoicing', 'clouddematinvoicing', 'falco-app.be']
export async function refreshInvoicePlatforms(): Promise<void> {
  try { const { getBusinessList } = await import('@/lib/settings/business'); PLATFORMS = (await getBusinessList('mail_factures_plateformes')).map(x => x.toLowerCase()) } catch { /* garde la liste connue */ }
}
const fromPlatform = (email: string) => PLATFORMS.some(d => (email || '').toLowerCase().includes(d))

/** Candidat « facture fournisseur » : une PJ, un sujet de facture, pas un assisteur. */
export function isSupplierCandidate(msg: AgentMessage): boolean {
  if (!msg.hasAttachments) return false
  if (NOT_SUPPLIER.test(msg.fromEmail)) return false
  return fromPlatform(msg.fromEmail) || INVOICE_SUBJECT.test(msg.subject || '')
}

export interface SupplierExtraction {
  supplier: string | null; invoice_number: string | null; invoice_date: string | null; total: number | null
  addressee: string | null; addressee_vat: string | null; is_reminder: boolean; is_credit_note: boolean
}
const PROMPT = `Tu lis un document reçu par une société de dépannage belge. Si c'est une facture (ou un rappel de facture) d'un fournisseur, réponds STRICTEMENT en JSON :
{"supplier":"<nom du fournisseur émetteur>","invoice_number":"<numéro de facture exact>","invoice_date":"<AAAA-MM-JJ ou null>","total":<montant TTC en euros ou null>,"addressee":"<nom exact de la société destinataire tel qu'écrit>","addressee_vat":"<TVA du destinataire sans espaces ni points, ou null>","is_reminder":<true si c'est un rappel/relance, sinon false>,"is_credit_note":<true si le DOCUMENT est un avoir / une note de crédit (mot « AVOIR », « note de crédit », « credit note », « creditnota », ou total négatif), sinon false>}
La nature se lit sur le DOCUMENT, jamais sur l'objet du mail : certains fournisseurs envoient leurs avoirs sous l'objet « Facture n° … » (Verviers Freins). Une note de crédit d'un fournisseur se décrit avec le même JSON, total en valeur absolue et "is_credit_note": true.
Si ce n'est NI une facture NI une note de crédit fournisseur (bon de commande, devis, publicité…), réponds {"not_invoice": true}. N'invente rien : null si absent.`

let _client: Anthropic | null = null
const client = () => (_client ??= aiClient('mail-agent/handlers/fournisseur', { apiKey: process.env.ANTHROPIC_API_KEY! }))
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
    is_credit_note: Boolean(parsed.is_credit_note) || (typeof parsed.total === 'number' && parsed.total < 0),
  }
}

/** Société du groupe qui ÉMET la facture (d'après le nom du fournisseur), sinon null. */
export function supplierCompanyOf(x: SupplierExtraction): CompanyKey | null {
  const s = (x.supplier || '').toLowerCase()
  if (/d[ée]pannage\s+riga|\briga\s+s\.?r\.?l|\briga\s+sprl/.test(s)) return 'riga'
  if (/\bdgj\b|dgj[\s.]*vhu/.test(s)) return 'dgj'
  if (/verviers\s*d[ée]pannage/.test(s)) return 'vd'
  return null
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

/**
 * La facture est-elle déjà dans Odoo pour cette société ? (numéro, sinon fournisseur + montant)
 * L'appel vise la société elle-même (odooRpcCompany) : odooRpc verrouille la
 * société 1 et ignore tout allowed_company_ids, si bien qu'une facture Riga ou
 * DGJ n'était jamais trouvée (0 sur 559 pour Riga, 04/10/2026) → retransférée
 * pour encodage (doublon) ou annoncée « à payer » alors que payée.
 * Lève une erreur si la société n'est pas consultable (accès Odoo refusé).
 */
export async function findVendorBill(company: CompanyKey, x: SupplierExtraction): Promise<{ name: string; ref: string | null; payment_state: string | null } | null> {
  const fields = ['name', 'ref', 'payment_state']
  const cid = COMPANIES[company].id
  if (x.invoice_number) {
    const num = x.invoice_number.replace(/[^A-Za-z0-9\/\-\.]/g, '')
    if (num.length >= 3) {
      const r: any[] = await odooRpcCompany(cid, 'account.move', 'search_read', [[['move_type', 'in', ['in_invoice', 'in_refund']], ['company_id', '=', cid], '|', ['ref', 'ilike', num], ['payment_reference', 'ilike', num]]], { fields, limit: 1 }) || []
      if (r.length) return r[0]
    }
  }
  // Fournisseur + montant : seulement à la même date (±3 jours). Sans elle, un abonnement
  // au montant fixe était pris pour la facture du mois précédent (TowSoft 01/10/2026).
  if (x.total != null && x.supplier && x.invoice_date) {
    const tok = x.supplier.split(/\s+/).filter(t => t.length >= 4)[0] || x.supplier.slice(0, 6)
    const d = new Date(x.invoice_date), lo = new Date(d.getTime() - 3 * 86400_000).toISOString().slice(0, 10), hi = new Date(d.getTime() + 3 * 86400_000).toISOString().slice(0, 10)
    const r: any[] = await odooRpcCompany(cid, 'account.move', 'search_read', [[['move_type', 'in', ['in_invoice', 'in_refund']], ['company_id', '=', cid], ['state', '!=', 'cancel'], ['partner_id', 'ilike', tok], ['amount_total', '>=', Math.abs(x.total) - 0.02], ['amount_total', '<=', Math.abs(x.total) + 0.02], ['invoice_date', '>=', lo], ['invoice_date', '<=', hi]]], { fields, limit: 1 }) || []
    if (r.length) return r[0]
  }
  return null
}

/** Ce fournisseur envoie-t-il d'habitude par Peppol (une facture Peppol ces 90 derniers jours) ? */
async function usuallyPeppol(company: CompanyKey, x: SupplierExtraction): Promise<boolean> {
  if (!x.supplier) return false
  const cid = COMPANIES[company].id
  const tok = x.supplier.split(/\s+/).filter(t => t.length >= 4)[0] || x.supplier.slice(0, 6)
  const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
  const n = await odooRpcCompany<number>(cid, 'account.move', 'search_count', [[['move_type', 'in', ['in_invoice', 'in_refund']], ['company_id', '=', cid], ['partner_id', 'ilike', tok], ['peppol_message_uuid', '!=', false], ['create_date', '>=', since]]]).catch(() => 0)
  return n > 0
}

/** Dossier où ranger le mail traité : « Dépannage Riga » pour Riga (s'il existe dans la boîte), sinon « Fournisseur Divers ». */
async function doneFolderFor(mailbox: string, company: CompanyKey | null): Promise<{ id: string | null; name: string }> {
  if (company === 'riga') {
    const id = await findFolderIdByName(mailbox, RIGA_FOLDER).catch(() => null)
    if (id) return { id, name: RIGA_FOLDER }
  }
  return { id: await findFolderIdByName(mailbox, FOURNISSEUR_DONE_FOLDER), name: FOURNISSEUR_DONE_FOLDER }
}

export interface SupplierOutcome { status: 'applied' | 'to_verify' | 'ignored' | 'skipped' | 'waiting'; note: string; extracted: any }

/**
 * Traite un mail candidat de bout en bout. Ne lève jamais : l'orchestrateur
 * trace ce qu'il renvoie.
 */
export async function processSupplierMail(sb: any, mailbox: string, msg: AgentMessage, base: Record<string, any>, opts: { known?: SupplierExtraction; afterWait?: boolean } = {}): Promise<SupplierOutcome> {
  const x = opts.known ?? await extractSupplierInvoice(mailbox, msg)
  if (x === 'not_invoice') return { status: 'skipped', note: 'pas une facture fournisseur', extracted: null }
  if (!x) return { status: 'to_verify', note: 'Facture fournisseur non lisible automatiquement — lecture humaine requise', extracted: null }
  const company = companyOf(x)
  const extracted: any = { ...x, company: company ? COMPANIES[company].label : null }
  if (!company) return { status: 'to_verify', note: `Destinataire non reconnu : « ${x.addressee || '?'} » — pour quelle société ?`, extracted }
  // Doublon : même numéro, même société, déjà traité — dans N'IMPORTE QUELLE boîte :
  // une même facture arrive souvent sur info@ ET administration@ (Verviers Freins,
  // transférée deux fois pour Riga le 01/10/2026).
  if (x.invoice_number) {
    const { data: twin } = await sb.from('mail_agent_items').select('id, status, folder, mailbox').eq('handler', 'fournisseur').neq('message_id', msg.id)
      .eq('extracted->>invoice_number', x.invoice_number).eq('extracted->>company', COMPANIES[company].label)
      .in('status', ['applied', 'to_verify']).order('id').limit(1).maybeSingle()
    if (twin) {
      const done = await doneFolderFor(mailbox, company)
      if (done.id) await moveMessage(mailbox, msg.id, done.id).catch(() => {})
      return { status: 'ignored', note: `Doublon : la facture ${x.invoice_number} a déjà été traitée (${twin.status}, boîte ${twin.mailbox}, dossier « ${twin.folder} »).`, extracted: { ...extracted, duplicateOf: twin.id } }
    }
  }
  let bill: Awaited<ReturnType<typeof findVendorBill>>
  try { bill = await findVendorBill(company, x) }
  catch (e: any) {
    // Société non consultable (ex. DGJ VHU : accès Odoo refusé au compte de l'app) :
    // ne jamais conclure « absente » → pas de transfert pour encodage, lecture humaine.
    return { status: 'to_verify', note: `Impossible de vérifier dans Odoo si la facture existe déjà (${COMPANIES[company].label}) — vérifier à la main avant d'encoder ou de payer`, extracted: { ...extracted, odooCheckError: String(e?.message || e).slice(0, 200) } }
  }
  const done = await doneFolderFor(mailbox, company)
  const doneId = done.id
  if (bill) {
    if (doneId) await moveMessage(mailbox, msg.id, doneId).catch(() => {})
    return { status: 'applied', note: `Déjà dans Odoo (${COMPANIES[company].label}) : ${bill.name}${bill.payment_state ? ' · ' + bill.payment_state : ''} → classée dans « ${done.name} »`, extracted: { ...extracted, odooBill: bill.name } }
  }
  // Facture ENTRE sociétés du groupe (ex. location Riga → VD) : l'ERP la crée
  // automatiquement des deux côtés (Olivier 05/10/2026). Jamais d'encodage :
  // la transférer créerait un doublon. Absente ici = écart à signaler.
  const issuer = supplierCompanyOf(x)
  if (issuer && issuer !== company) {
    return { status: 'to_verify', note: `Facture entre sociétés du groupe (${COMPANIES[issuer].label} → ${COMPANIES[company].label}) introuvable chez ${COMPANIES[company].label} : elle doit exister des deux côtés dans l'ERP (création automatique) — ne pas l'encoder, signaler l'écart`, extracted: { ...extracted, intraGroup: true } }
  }
  // Avoir (note de crédit) : l'alias d'achats de l'ERP en ferait une facture POSITIVE (Verviers Freins
  // 126015260 → « facture » de 45,70 € payée par Riga, 23/09/2026). Jamais transféré : signalé, à encoder
  // en note de crédit (Olivier 06/10/2026 : la nature se lit sur le document, pas sur l'objet du mail).
  if (x.is_credit_note) {
    return { status: 'to_verify', note: `Note de crédit (avoir) ABSENTE de l'ERP (${COMPANIES[company].label}) : ${x.supplier || '?'} n° ${x.invoice_number || '?'}${x.total != null ? ' · ' + Math.abs(x.total) + ' €' : ''} — à encoder comme NOTE DE CRÉDIT (pas transférée : l'encodage automatique en ferait une facture)`, extracted }
  }
  if (x.is_reminder) {
    return { status: 'to_verify', note: `Rappel d'une facture ABSENTE d'Odoo (${COMPANIES[company].label}) : ${x.supplier || '?'} n° ${x.invoice_number || '?'}${x.total != null ? ' · ' + x.total + ' €' : ''} — à encoder et à payer`, extracted }
  }
  // Fournisseur habitué de Peppol : la version Peppol arrive souvent quelques heures après le
  // mail (Verviers Freins, Odoo SA, 01/10/2026 → doublons). On attend 24 h, puis on revérifie.
  if (!opts.afterWait && await usuallyPeppol(company, x)) {
    return { status: 'waiting' as any, note: `Fournisseur habitué de Peppol : attente de 24 h avant l'envoi à l'encodage (la version Peppol arrive souvent plus tard)`, extracted: { ...extracted, waitUntil: new Date(Date.now() + 24 * 3600_000).toISOString() } }
  }
  const alias = COMPANIES[company].alias
  const fw = await forwardMessage(mailbox, msg.id, alias, `Encodage automatique (agent mail VD Soft) — ${COMPANIES[company].label} · ${x.supplier || ''} n° ${x.invoice_number || ''}`)
  if (!fw.ok) return { status: 'to_verify', note: `Absente d'Odoo, transfert vers ${alias} refusé (${fw.error || '?'})`, extracted }
  if (doneId) await moveMessage(mailbox, msg.id, doneId).catch(() => {})
  return { status: 'applied', note: `Absente d'Odoo → transférée pour encodage à ${alias} (${COMPANIES[company].label}), mail classé dans « ${done.name} »`, extracted: { ...extracted, forwardedTo: alias } }
}
