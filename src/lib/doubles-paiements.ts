// src/lib/doubles-paiements.ts
//
// DOUBLES PAIEMENTS CLIENTS, tranchés par Olivier dans Telegram (07/10/2026).
// Sujet « Doubles paiements » du groupe VD Soft - Mobi : un message de synthèse, puis un message
// par cas avec trois boutons. Le clic vaut son accord pour ce cas uniquement ; le message affiche
// ensuite la décision prise.
//   - Rembourser : le montant sort du compte d'attente vers le compte du client à rembourser, et un
//     virement de remboursement est préparé EN BROUILLON dans l'ERP (à exécuter dans la banque).
//   - Garder sur le compte client : le montant passe en avoir sur le compte du client.
//   - Rappel dans 15 jours : le message revient dans le sujet 15 jours plus tard.
// Vérifié avant l'envoi : aucun remboursement dans les comptes officiels (ING, Belfius, Scrada).

import { createAdminClient } from '@/lib/supabase'
import { odooRpc } from '@/lib/odoo'
import { tg } from '@/lib/sam/telegram'
import { decisionsGroup, topicId } from '@/lib/especes/telegram'

const SUSPENSE_CODE = '499000'
const eur = (n: number) => Number(n).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' })
const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const DP_TOPIC = () => topicId('Doubles paiements', 'telegram_sujet_doubles_paiements')

function keyboard(id: number) {
  return { inline_keyboard: [[{ text: '💸 Rembourser', callback_data: `dp:r:${id}` }, { text: '📒 Garder sur le compte client', callback_data: `dp:g:${id}` }], [{ text: '⏰ Rappel dans 15 jours', callback_data: `dp:p:${id}` }]] }
}

export async function sendCase(c: any): Promise<number | null> {
  const chat = await decisionsGroup(); const thread = await DP_TOPIC()
  if (!chat || !thread) throw new Error('Groupe ou sujet Telegram introuvable')
  const r = await tg('sendMessage', { chat_id: chat, message_thread_id: thread, text: c.body_html, parse_mode: 'HTML', reply_markup: keyboard(c.id) })
  const mid = r?.result?.message_id || null
  if (mid) await createAdminClient().from('doubles_paiements').update({ tg_message_id: mid, remind_at: null }).eq('id', c.id)
  return mid
}

export async function sendSummary(cases: any[]): Promise<void> {
  const chat = await decisionsGroup(); const thread = await DP_TOPIC()
  const total = cases.reduce((s, c) => s + Number(c.amount), 0)
  await tg('sendMessage', { chat_id: chat, message_thread_id: thread, parse_mode: 'HTML',
    text: `💶 <b>Doubles paiements — ${cases.length} cas à trancher</b>\n${eur(total)} reçus en trop sur le compte ING en 2026. Aucun n'a été remboursé (vérifié dans ING, Belfius et Scrada).\nIPA 68,97 € et VAB 942,80 € attendent la réponse de Maureen.\n\nUn message par cas ci-dessous. Ton clic vaut accord pour ce cas seulement :\n• 💸 <b>Rembourser</b> : le montant passe sur le compte du client et le virement est préparé en brouillon (à exécuter dans la banque).\n• 📒 <b>Garder sur le compte client</b> : avoir à déduire de ses prochaines factures.\n• ⏰ <b>Rappel dans 15 jours</b> : le message reviendra.` })
}

/** La contrepartie « compte d'attente » de la ligne de banque passe sur le compte du client (avec le client). */
async function suspenseToCustomer(lineId: number, partnerId: number, amount: number): Promise<void> {
  const [l] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[lineId]], { fields: ['move_id'] })
  const sus = await odooRpc<any[]>('account.move.line', 'search_read', [[['move_id', '=', l.move_id[0]], ['account_id.code', '=', SUSPENSE_CODE]]], { fields: ['id', 'credit'] })
  const line = sus.find(s => Math.abs(Number(s.credit) - amount) < 0.01)
  if (!line) throw new Error('Montant plus en compte d’attente : déjà régularisé ?')
  const [p] = await odooRpc<any[]>('res.partner', 'read', [[partnerId]], { fields: ['property_account_receivable_id'] })
  await odooRpc('account.move', 'button_draft', [[l.move_id[0]]])
  try { await odooRpc('account.move', 'write', [[l.move_id[0]], { line_ids: [[1, line.id, { account_id: p.property_account_receivable_id[0], partner_id: partnerId }]] }]) }
  finally { await odooRpc('account.move', 'action_post', [[l.move_id[0]]]) }
}

async function draftRefund(c: any): Promise<{ id: number; note: string }> {
  const [ing] = await odooRpc<any[]>('account.journal', 'search_read', [[['code', '=', 'ING1']]], { fields: ['id'] })
  let bankId: number | false = false
  if (c.refund_iban) {
    const norm = String(c.refund_iban).replace(/\s/g, '')
    const ex = await odooRpc<any[]>('res.partner.bank', 'search_read', [[['partner_id', '=', c.refund_partner_id], ['acc_number', 'ilike', norm.slice(-8)]]], { fields: ['id', 'acc_number'] })
    bankId = ex.find(b => String(b.acc_number).replace(/\s/g, '') === norm)?.id || await odooRpc<number>('res.partner.bank', 'create', [{ partner_id: c.refund_partner_id, acc_number: norm }])
  }
  const id = await odooRpc<number>('account.payment', 'create', [{
    payment_type: 'outbound', partner_type: 'customer', partner_id: c.refund_partner_id, amount: Number(c.amount), journal_id: ing.id,
    memo: `Remboursement double paiement — facture ${c.invoice}`, ...(bankId ? { partner_bank_id: bankId } : {}),
  }])
  return { id, note: bankId ? `virement préparé en brouillon (${c.refund_iban})` : 'virement préparé en brouillon — IBAN du client à compléter' }
}

/** Clic sur un bouton. Retourne le texte de confirmation. */
export async function decide(id: number, act: 'r' | 'g' | 'p', who: string): Promise<{ note: string; c: any | null }> {
  const sb = createAdminClient()
  const { data: c } = await sb.from('doubles_paiements').select('*').eq('id', id).maybeSingle()
  if (!c) return { note: 'Cas inconnu', c: null }
  if (c.status !== 'open') return { note: `Déjà tranché : ${c.decision_note}`, c }
  const now = new Date()
  if (act === 'p') {
    const at = new Date(now.getTime() + 15 * 86_400_000)
    await sb.from('doubles_paiements').update({ remind_at: at.toISOString() }).eq('id', id)
    return { note: `⏰ Rappel le ${at.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })} (${who})`, c }
  }
  let note: string, patch: Record<string, any>
  if (act === 'g') {
    await suspenseToCustomer(c.statement_line_id, c.keep_partner_id, Number(c.amount))
    note = `📒 Gardé en avoir sur le compte client — ${who}, ${now.toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })}`
    patch = { status: 'kept' }
  } else {
    await suspenseToCustomer(c.statement_line_id, c.refund_partner_id, Number(c.amount))
    const r = await draftRefund(c)
    note = `💸 Remboursement : ${r.note} — ${who}, ${now.toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' })}`
    patch = { status: 'refunded', payment_id: r.id }
  }
  await sb.from('doubles_paiements').update({ ...patch, decided_by: who, decided_at: now.toISOString(), decision_note: note, remind_at: null }).eq('id', id)
  return { note, c: { ...c, ...patch } }
}

/** Tâche de 15 min : les rappels arrivés à échéance renvoient le message du cas. */
export async function sendDueReminders(): Promise<number> {
  const sb = createAdminClient()
  const { data } = await sb.from('doubles_paiements').select('*').eq('status', 'open').not('remind_at', 'is', null).lte('remind_at', new Date().toISOString())
  let n = 0
  for (const c of data || []) { if (await sendCase({ ...c, body_html: `⏰ <b>Rappel</b>\n${c.body_html}` }).catch(() => null)) n++ }
  return n
}

export { eur, esc }
