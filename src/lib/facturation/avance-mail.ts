// src/lib/facturation/avance-mail.ts — refacturation d'une avance de fonds envoyée AUSSI par mail (Olivier 16/10/2026).
//
// L'envoi Peppol ne transmet que la facture (PDF + XML) : le justificatif du garage, joint à la facture dans l'ERP,
// n'arrive pas chez le client (Touring a dû le redemander pour 2026/10/116). Règle : une avance de fonds part par
// Peppol ET par mail, depuis administration@, avec la facture et le justificatif.
import { odooRpcCompany } from '@/lib/odoo'
import { sendEmail } from '@/lib/emails'

const ADMIN_FROM = 'administration@verviersdepannage.com'

export async function sendAvanceParMail(company: number, invoiceId: number): Promise<{ ok: boolean; note: string }> {
  const [inv]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[invoiceId]], { fields: ['name', 'ref', 'state', 'partner_id', 'amount_total', 'invoice_pdf_report_id'] })
  if (!inv || inv.state !== 'posted') return { ok: false, note: 'facture introuvable ou pas validée' }
  // Adresse de facturation : contact « facture » du client s'il existe, sinon le client.
  const contacts: any[] = await odooRpcCompany(company, 'res.partner', 'search_read', [['|', ['id', '=', inv.partner_id[0]], ['parent_id', '=', inv.partner_id[0]]]], { fields: ['email', 'type'] })
  const to = (contacts.find(c => c.type === 'invoice' && c.email) || contacts.find(c => c.email))?.email
  if (!to) return { ok: false, note: `aucune adresse mail de facturation pour ${inv.partner_id[1]}` }
  const atts: any[] = await odooRpcCompany(company, 'ir.attachment', 'search_read', [[['res_model', '=', 'account.move'], ['res_id', '=', invoiceId], ['mimetype', '=', 'application/pdf']]], { fields: ['id', 'name', 'datas'] })
  // Le PDF officiel de la facture est une pièce « champ » (invisible à la recherche) : on le lit par son id.
  const facture = inv.invoice_pdf_report_id
    ? ((await odooRpcCompany<any[]>(company, 'ir.attachment', 'read', [[inv.invoice_pdf_report_id[0]]], { fields: ['id', 'name', 'datas'] }))[0] || null)
    : null
  const justifs = atts.filter(a => /^justificatif/i.test(a.name))
  if (!facture || !justifs.length) return { ok: false, note: `pièces manquantes (facture ${facture ? 'ok' : 'absente'}, justificatif ${justifs.length ? 'ok' : 'absent'})` }
  const eur = `${Number(inv.amount_total).toFixed(2).replace('.', ',')} €`
  const html = `<p>Madame, Monsieur,</p><p>Veuillez trouver en annexe notre facture <b>${inv.name}</b>${inv.ref ? ` (votre dossier <b>${inv.ref}</b>)` : ''}, ${eur} TVAC, relative à une avance de fonds, ainsi que la facture du prestataire en justificatif. La facture vous a également été transmise par Peppol.</p><p>Bien à vous,</p><p>Verviers Dépannage SA<br>Service administratif — ${ADMIN_FROM}</p>`
  await sendEmail(to, `Facture ${inv.name}${inv.ref ? ` — dossier ${inv.ref}` : ''} — avance de fonds et justificatif`, html, inv.partner_id[1], undefined,
    [facture, ...justifs].map(a => ({ name: a.name, contentType: 'application/pdf', contentBytes: a.datas })), ADMIN_FROM)
  return { ok: true, note: `envoyée aussi par mail à ${to} avec ${justifs.length} justificatif(s)` }
}
