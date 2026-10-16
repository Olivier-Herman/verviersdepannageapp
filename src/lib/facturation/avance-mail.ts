// src/lib/facturation/avance-mail.ts — envoi d'une refacturation d'avance de fonds (Olivier 16/10/2026).
//
// L'envoi Peppol seul ne transmet que la facture (PDF + XML) : le justificatif du garage n'arrive pas chez le client
// (Touring a dû le redemander pour 2026/10/116). Règle : on envoie DEPUIS L'ERP, « par e-mail » ET « par Peppol »
// cochés, le justificatif ajouté aux pièces jointes du mail — la trace reste dans l'historique de la facture.
import { odooRpcCompany } from '@/lib/odoo'

export async function sendAvanceDepuisErp(company: number, invoiceId: number): Promise<{ ok: boolean; note: string }> {
  const [inv]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[invoiceId]], { fields: ['name', 'state', 'partner_id'] })
  if (!inv || inv.state !== 'posted') return { ok: false, note: 'facture introuvable ou pas validée' }
  const justifs: any[] = await odooRpcCompany(company, 'ir.attachment', 'search_read', [[['res_model', '=', 'account.move'], ['res_id', '=', invoiceId], ['name', '=ilike', 'justificatif%']]], { fields: ['id', 'name', 'mimetype'] })
  if (!justifs.length) return { ok: false, note: 'justificatif absent de la facture : rien n’est envoyé' }
  // Destinataire du mail : contact « facture » du client s'il a une adresse, sinon le client.
  const contacts: any[] = await odooRpcCompany(company, 'res.partner', 'search_read', [['|', ['id', '=', inv.partner_id[0]], ['parent_id', '=', inv.partner_id[0]]]], { fields: ['id', 'email', 'type'] })
  const dest = contacts.find(c => c.type === 'invoice' && c.email) || contacts.find(c => c.email)
  if (!dest) return { ok: false, note: `aucune adresse mail de facturation pour ${inv.partner_id[1]}` }

  const ctx = { context: { active_model: 'account.move', active_ids: [invoiceId], active_id: invoiceId } }
  const wiz = await odooRpcCompany<number>(company, 'account.move.send.wizard', 'create', [{ move_id: invoiceId }], ctx)
  const [w0]: any[] = await odooRpcCompany(company, 'account.move.send.wizard', 'read', [[wiz]], { fields: ['sending_method_checkboxes', 'mail_attachments_widget'], ...ctx })
  const boxes = w0.sending_method_checkboxes || {}
  const methods = ['email', ...(boxes.peppol && !boxes.peppol.readonly ? ['peppol'] : [])]
  const checked = Object.fromEntries(Object.entries<any>(boxes).map(([k, v]) => [k, { ...v, checked: methods.includes(k) }]))
  const widget = [...(w0.mail_attachments_widget || []), ...justifs.map(j => ({ id: j.id, name: j.name, mimetype: j.mimetype || 'application/pdf', placeholder: false, manual: true }))]
  await odooRpcCompany(company, 'account.move.send.wizard', 'write', [[wiz], { sending_method_checkboxes: checked, sending_methods: methods, mail_partner_ids: [[6, 0, [dest.id]]], mail_attachments_widget: widget }], ctx)
  await odooRpcCompany(company, 'account.move.send.wizard', 'action_send_and_print', [[wiz]], ctx)
  const [a]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[invoiceId]], { fields: ['peppol_move_state', 'is_move_sent'] })
  return { ok: !!a.is_move_sent, note: `envoyée depuis l’ERP par ${methods.join(' + ')} à ${dest.email}, avec ${justifs.map(j => j.name).join(', ')} (Peppol : ${a.peppol_move_state || '—'})` }
}
