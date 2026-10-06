// src/lib/agents/aurelie-sel.ts
//
// Aurélie, facturation (Olivier 06/10/2026, « Ok pour aurelie ») : les autofactures
// Peppol d'AWP / AP Solutions (« 20xxSEL… ») arrivent en brouillon de facture client.
// Règle du 05/10, entièrement mécanique, donc SANS IA : validation, puis « Envoyer »
// avec tous les canaux décochés — l'ERP génère et lie NOTRE PDF, rien ne part.
// Tout ce qui ne remplit pas tous les critères n'est pas touché. À la moindre
// anomalie (un canal reste coché, un mail apparaît) : arrêt, journal en échec,
// notification à Olivier.

import { odooRpc } from '@/lib/odoo'
import { PAYERS } from '@/lib/advice-match'
import { sendPushToUsers } from '@/lib/push'
import { journal } from './core'
import { answererIds } from './question'

const AGENT = 'Aurélie'
const isSel = (ref: string) => /^20\d\dSEL/.test(ref || '')

async function alertOlivier(body: string) {
  await sendPushToUsers(await answererIds(null), { title: 'Aurélie arrêtée', body, url: '/admin/agents', tag: 'aurelie-sel' }).catch(() => {})
}

export async function runAurelieSel(dryRun = false): Promise<{ vues: number; validees: string[]; arret?: string }> {
  const partners = [...(PAYERS.find(p => p.key === 'awp')?.partnerIds || [])]
  const dom = [['company_id', '=', 1], ['move_type', '=', 'out_invoice'], ['state', '=', 'draft'], ['ref', '=like', '20__SEL%'], ['peppol_message_uuid', '!=', false], ['partner_id', 'in', partners]]
  const list: any[] = await odooRpc('account.move', 'search_read', [dom], { fields: ['id', 'ref', 'partner_id', 'amount_total'], order: 'id' })
  const res = { vues: list.length, validees: [] as string[], arret: undefined as string | undefined }
  if (dryRun) { res.validees = list.map(x => `${x.ref} · ${x.amount_total} €`); return res }
  for (const it of list) {
    const ID = it.id
    const [m]: any[] = await odooRpc('account.move', 'read', [[ID]], { fields: ['state', 'ref', 'move_type', 'company_id', 'peppol_message_uuid', 'partner_id'] })
    if (m.state !== 'draft' || m.move_type !== 'out_invoice' || m.company_id?.[0] !== 1 || !isSel(m.ref) || !m.peppol_message_uuid || !partners.includes(m.partner_id?.[0])) continue
    const before: any[] = await odooRpc('mail.message', 'search_read', [[['model', '=', 'account.move'], ['res_id', '=', ID]]], { fields: ['id'] })
    await odooRpc('account.move', 'action_post', [[ID]])
    const ctx = { context: { active_model: 'account.move', active_ids: [ID], active_id: ID } }
    const wiz = await odooRpc<number>('account.move.send.wizard', 'create', [{ move_id: ID }], ctx)
    const [w0]: any[] = await odooRpc('account.move.send.wizard', 'read', [[wiz]], { fields: ['sending_method_checkboxes'], ...ctx })
    const boxes = Object.fromEntries(Object.entries<any>(w0.sending_method_checkboxes || {}).map(([k, v]) => [k, { ...v, checked: false }]))
    await odooRpc('account.move.send.wizard', 'write', [[wiz], { sending_method_checkboxes: boxes, sending_methods: [] }], ctx)
    const [w]: any[] = await odooRpc('account.move.send.wizard', 'read', [[wiz]], { fields: ['sending_methods', 'sending_method_checkboxes'], ...ctx })
    if ((w.sending_methods || []).length || Object.values<any>(w.sending_method_checkboxes || {}).some(b => b?.checked)) {
      res.arret = `${m.ref} : un canal d’envoi reste coché. Facture validée mais PAS envoyée ; tâche arrêtée.`
      break
    }
    await odooRpc('account.move.send.wizard', 'action_send_and_print', [[wiz]], ctx)
    const [a]: any[] = await odooRpc('account.move', 'read', [[ID]], { fields: ['name', 'state', 'is_move_sent', 'invoice_pdf_report_id'] })
    const mails: any[] = await odooRpc('mail.mail', 'search_read', [[['model', '=', 'account.move'], ['res_id', '=', ID]]], { fields: ['id'] })
    const msgs: any[] = await odooRpc('mail.message', 'search_read', [[['model', '=', 'account.move'], ['res_id', '=', ID], ['id', 'not in', before.map(b => b.id)], ['message_type', 'in', ['email', 'email_outgoing']]]], { fields: ['id'] })
    if (a.state !== 'posted' || !a.invoice_pdf_report_id || mails.length || msgs.length) {
      res.arret = `${m.ref} → ${a.name} : anomalie après envoi (PDF ${a.invoice_pdf_report_id ? 'présent' : 'absent'}, mails ${mails.length}, messages sortants ${msgs.length}). Tâche arrêtée.`
      break
    }
    res.validees.push(`${m.ref} → ${a.name}`)
    await journal({ agent: AGENT, company: 1, action: 'facture SEL validée', detail: `${m.ref} → ${a.name} · ${m.partner_id[1]} · ${it.amount_total} € · PDF lié, rien envoyé` })
  }
  if (res.arret) {
    await journal({ agent: AGENT, company: 1, action: 'factures SEL : arrêt', detail: res.arret, ok: false })
    await alertOlivier(res.arret)
  }
  return res
}
