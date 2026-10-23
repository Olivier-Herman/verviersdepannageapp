// src/lib/agents/tva-declaration.ts — déclaration TVA de la comptable → facture fournisseur (Olivier 23/10/2026).
//
// « On capture le mail que Maureen envoie chaque fois pour le montant à payer, on l'encode dans l'ERP pour pouvoir lier
// le paiement, comme ça je peux les présenter dans les lots de paiement à Momo. » Chaque mail « <SOCIÉTÉ> - DECLARATION
// TVA MM-AAAA » du cabinet comptable (info@) devient une proposition de Victor ; validée, elle crée une facture
// fournisseur « VAT Revenue Services », compte 451000 sans taxe, échéance et communication structurée du mail, le mail
// joint en PDF. Le virement au service TVA se rapproche ensuite avec elle (montant et communication identiques).
// DGJ : pas de relevés bancaires dans l'ERP → hors périmètre (Olivier 23/10/2026 : « notre important c'est Riga et VD »).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { odooRpcCompany } from '@/lib/odoo'
import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { MAIL_AGENT_MAILBOX } from '@/lib/mail-agent'
import { getBusinessNumber, getBusinessText } from '@/lib/settings/business'

export interface TvaDeclaration {
  message_id: string; sujet: string; recu_le: string
  societe: number; periode: string; montant: number; echeance: string; communication: string; ref: string
}

const SOCIETES: [RegExp, number][] = [[/VERVIERS\s+D[EÉ]PANNAGE/i, 1], [/RIGA/i, 2], [/DGJ/i, 3]]

/** Lit sujet + texte d'un mail de déclaration : société, période, montant, date limite, communication. */
export function parseTvaMail(sujet: string, texte: string): Omit<TvaDeclaration, 'message_id' | 'sujet' | 'recu_le'> | null {
  const per = sujet.match(/DECLARATION\s+TVA\s+(\d{2})-(\d{4})/i)
  const soc = SOCIETES.find(([re]) => re.test(sujet))
  const mt = texte.match(/montant\s+de\s+([\d.\s]+,\d{2})\s*€/i)
  const dl = texte.match(/(?:avant\s+ce|aujourd['’]hui,?\s+ce)\s+(\d{2})\/(\d{2})\/(\d{4})/i)
  const cs = texte.match(/\+{3}\s*(\d{3})\/(\d{4})\/(\d{5})\s*\+{3}/)
  if (!per || !soc || !mt || !dl || !cs) return null
  const montant = Number(mt[1].replace(/[.\s]/g, '').replace(',', '.'))
  if (!(montant > 0)) return null
  return { societe: soc[1], periode: `${per[1]}-${per[2]}`, montant, echeance: `${dl[3]}-${dl[2]}-${dl[1]}`,
    communication: `+++${cs[1]}/${cs[2]}/${cs[3]}+++`, ref: `Déclaration TVA ${per[1]}-${per[2]}` }
}

async function graph(path: string): Promise<any> {
  let tok = await getAppOnlyToken()
  let r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
  if (r.status === 401) { tok = await getAppOnlyToken(true); r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' }) }
  if (!r.ok) throw new Error(`Lecture du mail impossible (${r.status})`)
  return r.json()
}

const texteDe = (html: string) => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()

/** Le mail du cabinet, relu dans info@ : la proposition ne repose jamais sur ce qu'un agent a recopié. */
export async function lireDeclaration(messageId: string): Promise<{ decl: TvaDeclaration; texte: string; de: string; a: string }> {
  const m = await graph(`/users/${MAIL_AGENT_MAILBOX}/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,toRecipients,receivedDateTime,body`)
  const domaine = (await getBusinessText('agents_domaine_comptable')).toLowerCase()
  const de = String(m.from?.emailAddress?.address || '').toLowerCase()
  if (!domaine || !de.endsWith('@' + domaine)) throw new Error('Ce mail ne vient pas du cabinet comptable.')
  const texte = texteDe(m.body?.content)
  const p = parseTvaMail(String(m.subject || ''), texte)
  if (!p) throw new Error('Mail de déclaration TVA illisible (société, période, montant, date limite ou communication introuvable).')
  return { decl: { ...p, message_id: m.id, sujet: m.subject, recu_le: m.receivedDateTime }, texte, de, a: (m.toRecipients || []).map((t: any) => t.emailAddress?.address).join(', ') }
}

/** Mails de déclaration TVA du cabinet reçus depuis `depuis` (ISO). */
export async function chercherDeclarations(depuis: string): Promise<{ id: string; sujet: string }[]> {
  const domaine = (await getBusinessText('agents_domaine_comptable')).toLowerCase()
  // info@ reçoit des centaines de mails par semaine : recherche par mots (sujet), puis filtre date + expéditeur.
  const j = await graph(`/users/${MAIL_AGENT_MAILBOX}/messages?$search=${encodeURIComponent('"DECLARATION TVA"')}&$top=50&$select=id,subject,from,receivedDateTime`)
  return (j.value || [])
    .filter((m: any) => String(m.receivedDateTime || '') >= depuis && /DECLARATION\s+TVA\s+\d{2}-\d{4}/i.test(m.subject || '') && String(m.from?.emailAddress?.address || '').toLowerCase().endsWith('@' + domaine))
    .map((m: any) => ({ id: m.id, sujet: m.subject }))
}

/** Le mail en PDF (police standard : les caractères hors latin-1 sont remplacés). */
export async function mailEnPdf(sujet: string, de: string, a: string, recu: string, texte: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const clean = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€]/g, '')
  const lignes: { t: string; b?: boolean }[] = [
    { t: `De : ${de}`, b: true }, { t: `À : ${a}`, b: true },
    { t: `Date : ${new Date(recu).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })}`, b: true }, { t: `Objet : ${sujet}`, b: true }, { t: '' },
  ]
  const wrap = (s: string, f: any, size: number, max: number) => {
    const out: string[] = []; let cur = ''
    for (const w of s.split(' ')) { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > max && cur) { out.push(cur); cur = w } else cur = t }
    out.push(cur); return out
  }
  for (const par of clean(texte).split('\n')) lignes.push(...(par.trim() ? wrap(par.trim(), font, 10, 500).map(t => ({ t })) : [{ t: '' }]))
  let page = doc.addPage([595, 842]); let y = 800
  for (const l of lignes) {
    if (y < 50) { page = doc.addPage([595, 842]); y = 800 }
    for (const t of l.b ? wrap(clean(l.t), bold, 10, 500) : [clean(l.t)]) { page.drawText(t, { x: 48, y, size: 10, font: l.b ? bold : font, color: rgb(0.1, 0.1, 0.1) }); y -= 14 }
  }
  return Buffer.from(await doc.save())
}

const R = (co: number, model: string, method: string, args: any[], kw: any = {}) =>
  odooRpcCompany<any>(co, model, method, args, { ...kw, context: { ...(kw.context || {}), allowed_company_ids: [co] } })

/** Facture déjà encodée pour cette déclaration (même tiers, même référence, non annulée) ? */
export async function factureExistante(d: Pick<TvaDeclaration, 'societe' | 'ref'>): Promise<string | null> {
  const partner = await getBusinessNumber('odoo_partner_tva')
  const r = await R(d.societe, 'account.move', 'search_read', [[['move_type', '=', 'in_invoice'], ['partner_id', '=', partner], ['ref', '=', d.ref], ['company_id', '=', d.societe], ['state', '!=', 'cancel']]], { fields: ['name'], limit: 1 })
  return r?.[0]?.name || null
}

/** Crée, joint le mail en PDF et valide la facture. */
export async function encoderDeclaration(messageId: string): Promise<{ facture: string; montant: number }> {
  const { decl: d, texte, de, a } = await lireDeclaration(messageId)
  if (d.societe === 3) throw new Error('DGJ : hors périmètre tant que ses relevés ne sont pas dans l’ERP (Olivier 23/10/2026).')
  const deja = await factureExistante(d)
  if (deja) throw new Error(`Déjà encodée : ${deja}.`)
  const partner = await getBusinessNumber('odoo_partner_tva')
  const [acc] = await R(d.societe, 'account.account', 'search_read', [[['code', '=', '451000']]], { fields: ['id'], limit: 1 })
  const [jr] = await R(d.societe, 'account.journal', 'search_read', [[['type', '=', 'purchase'], ['company_id', '=', d.societe], ['code', '!=', 'PAIE']]], { fields: ['id'], order: 'id', limit: 1 })
  if (!acc || !jr) throw new Error('Compte 451000 ou journal d’achats introuvable dans cette société.')
  const date = d.recu_le.slice(0, 10)
  const id = await R(d.societe, 'account.move', 'create', [{ move_type: 'in_invoice', journal_id: jr.id, partner_id: partner, invoice_date: date, invoice_date_due: d.echeance, ref: d.ref, payment_reference: d.communication,
    invoice_line_ids: [[0, 0, { name: `${d.ref} — à payer au service TVA`, account_id: acc.id, quantity: 1, price_unit: d.montant, tax_ids: [[6, 0, []]] }]] }])
  const pdf = await mailEnPdf(d.sujet, de, a, d.recu_le, texte)
  const att = await R(d.societe, 'ir.attachment', 'create', [{ name: `${d.ref} — mail du ${date}.pdf`, datas: pdf.toString('base64'), res_model: 'account.move', res_id: id, mimetype: 'application/pdf' }])
  await R(d.societe, 'account.move', 'write', [[id], { message_main_attachment_id: att }])
  await R(d.societe, 'account.move', 'action_post', [[id]])
  const [f] = await R(d.societe, 'account.move', 'read', [[id]], { fields: ['name'] })
  return { facture: f.name, montant: d.montant }
}
