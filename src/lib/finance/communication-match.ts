// src/lib/finance/communication-match.ts
//
// VIREMENTS RAPPROCHÉS PAR LEUR COMMUNICATION (Olivier 09/10/2026).
// Un client ou une assistance sans avis de paiement (Touring, un particulier…) cite ses factures dans la
// communication du virement. On les retrouve (lecture tolérante : numéros collés ou coupés par la banque), on
// compare la somme de leurs restes dus au montant reçu, et le paiement rejoint la file « Paiements assureurs » :
// « Prêt » quand tout tombe juste, « Écart » sinon. Rien n'est écrit ici : le rapprochement reste un clic.
//
// Note de crédit non déduite (Touring, NC 2026-0278, 09/10/2026) : le client paie une facture en entier alors que
// notre note de crédit y est lettrée. Règle d'Olivier : on DÉLETTRE la note de crédit, le virement solde la facture
// en entier, la note de crédit reste ouverte pour le paiement où le client la déduira. Proposé seulement quand
// l'écart vaut exactement ces notes de crédit et qu'elles ne sont pas citées dans la communication.

import { odooRpc } from '@/lib/odoo'
import { invoiceMentions, allCandidates } from './communication-invoices'
import type { MatchedAdvicePayment, MatchedInvoice } from '@/lib/advice-match'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface CreditNoteToUnletter { lineId: number; name: string; amount: number; invoiceName: string }

export async function communicationItems(sinceIso: string, skipLineIds: Set<number>): Promise<MatchedAdvicePayment[]> {
  const lines = await odooRpc<any[]>('account.bank.statement.line', 'search_read', [[
    ['amount', '>', 0], ['date', '>=', sinceIso.slice(0, 10)], ['is_reconciled', '=', false],
  ]], { fields: ['id', 'date', 'amount', 'payment_ref', 'move_id', 'partner_id'], order: 'date desc, id desc', limit: 500 })

  const withMentions = lines
    .filter(l => !skipLineIds.has(l.id))
    .map(l => ({ l, mentions: invoiceMentions(String(l.payment_ref || '')) }))
    .filter(x => x.mentions.length)
  if (!withMentions.length) return []

  const names = [...new Set(withMentions.flatMap(x => allCandidates(x.mentions)))]
  const moves = await odooRpc<any[]>('account.move', 'search_read', [[
    ['name', 'in', names], ['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']],
  ]], { fields: ['id', 'name', 'move_type', 'amount_total', 'amount_residual', 'payment_state', 'commercial_partner_id', 'reversal_move_ids'], limit: names.length + 20 })
  const byName = new Map(moves.map(m => [m.name, m]))

  // Notes de crédit lettrées sur les factures citées (candidates « non déduites »).
  const ncIds = [...new Set(moves.filter(m => m.move_type === 'out_invoice').flatMap(m => m.reversal_move_ids || []))] as number[]
  const ncs = ncIds.length ? await odooRpc<any[]>('account.move', 'read', [ncIds], { fields: ['id', 'name', 'state', 'amount_total', 'amount_residual', 'reversed_entry_id'] }) : []
  const ncLines = ncIds.length ? await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['move_id', 'in', ncIds], ['account_id.account_type', '=', 'asset_receivable'], ['reconciled', '=', true],
  ]], { fields: ['id', 'move_id'] }) : []

  const items: MatchedAdvicePayment[] = []
  for (const { l, mentions } of withMentions) {
    const cited = new Set<string>()
    const invoices: MatchedInvoice[] = []
    for (const m of mentions) {
      const name = m.candidates.find(c => byName.has(c))
      if (!name) {
        invoices.push({ ref: m.candidates[0], amount: 0, invoiceId: null, invoiceName: null, invoiceTotal: null, residual: null, paymentState: null, matchedBy: null, issue: 'introuvable' })
        continue
      }
      if (cited.has(name)) continue
      cited.add(name)
      const inv = byName.get(name)
      const refund = inv.move_type === 'out_refund'
      const residual = r2(Math.abs(Number(inv.amount_residual || 0))) * (refund ? -1 : 1)
      invoices.push({
        ref: name, amount: residual, invoiceId: inv.id, invoiceName: inv.name,
        invoiceTotal: r2(Number(inv.amount_total) * (refund ? -1 : 1)), residual,
        paymentState: inv.payment_state, matchedBy: 'numéro',
        issue: Math.abs(residual) < 0.005 ? 'déjà soldée' : null,
      })
    }

    const found = invoices.filter(i => i.invoiceId && !i.issue)
    let linesSum = r2(found.reduce((s, i) => s + i.amount, 0))
    let delta = r2(linesSum - Number(l.amount))
    const notes: string[] = []
    let unletter: CreditNoteToUnletter[] = []

    // Le client a payé plus que les restes dus : notes de crédit lettrées qu'il n'a pas déduites ?
    if (delta < -0.02) {
      const options: (CreditNoteToUnletter & { invoiceId: number })[] = []
      for (const inv of found) {
        const src = moves.find(m => m.id === inv.invoiceId)
        for (const ncId of src?.reversal_move_ids || []) {
          const nc = ncs.find(n => n.id === ncId)
          const ln = ncLines.find(x => x.move_id[0] === ncId)
          if (!nc || nc.state !== 'posted' || !ln || cited.has(nc.name) || Math.abs(Number(nc.amount_residual || 0)) > 0.005) continue
          options.push({ lineId: ln.id, name: nc.name, amount: r2(Number(nc.amount_total)), invoiceName: inv.invoiceName!, invoiceId: inv.invoiceId! })
        }
      }
      const sum = r2(options.reduce((s, o) => s + o.amount, 0))
      const single = options.find(o => Math.abs(o.amount + delta) < 0.02)
      const chosen = single ? [single] : Math.abs(sum + delta) < 0.02 ? options : []
      if (chosen.length) {
        unletter = chosen.map(({ invoiceId, ...o }) => o)
        for (const o of chosen) {
          const x = found.find(i => i.invoiceId === o.invoiceId)!
          x.amount = r2(x.amount + o.amount)
          notes.push(`${o.invoiceName} payée en entier sans déduire la note de crédit ${o.name} (${o.amount.toFixed(2)} €) : au rapprochement, la note de crédit est délettrée et reste ouverte pour le paiement où le client la déduira.`)
        }
        linesSum = r2(found.reduce((s, i) => s + i.amount, 0))
        delta = r2(linesSum - Number(l.amount))
      }
    }

    const blocking: string[] = []
    for (const x of invoices) {
      if (x.issue === 'introuvable') blocking.push(`La communication cite ${x.ref}, qui ne correspond à aucune facture`)
      if (x.issue === 'déjà soldée') blocking.push(`${x.invoiceName} est déjà soldée`)
    }
    if (Math.abs(delta) > 0.02) blocking.push(`Les factures citées totalisent ${linesSum.toFixed(2)} € pour un virement de ${Number(l.amount).toFixed(2)} €`)

    const partner = Array.isArray(l.partner_id) ? l.partner_id : null
    const firstInv = moves.find(m => m.id === found[0]?.invoiceId)
    items.push({
      state: invoices.some(i => i.issue === 'introuvable') && !found.length ? 'miss' : blocking.length ? 'gap' : 'ready',
      payer: 'communication',
      payerLabel: partner?.[1] || firstInv?.commercial_partner_id?.[1] || 'Virement client',
      advice: null,
      bank: { lineId: l.id, date: l.date, amount: Number(l.amount), moveName: Array.isArray(l.move_id) ? l.move_id[1] : '' },
      invoices, linesSum, delta, blocking,
      source: 'communication',
      communication: String(l.payment_ref || '').replace(/^[\s\S]*?communication\s*:?\s*/i, '').slice(0, 300),
      partnerId: Number(partner?.[0] || firstInv?.commercial_partner_id?.[0] || 0),
      notes,
      creditNotesToUnletter: unletter,
    })
  }
  return items
}
