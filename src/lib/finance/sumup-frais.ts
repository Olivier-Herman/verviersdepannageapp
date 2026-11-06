// src/lib/finance/sumup-frais.ts
//
// Lettrage de la facture de frais SumUp du mois avec les commissions passées en OD à chaque versement (Olivier
// 06/11/2026) : seulement si le total est exact au centime. Sinon rien n'est touché et le cas est signalé.

import { odooRpc } from '@/lib/odoo'
import { journal } from '@/lib/agents/core'

const r2 = (n: number) => Math.round(n * 100) / 100

export async function lettrerFraisSumup(): Promise<{ lettres: string[]; aTrancher: string[] }> {
  const out = { lettres: [] as string[], aTrancher: [] as string[] }
  const factures = await odooRpc<any[]>('account.move', 'search_read', [[
    ['company_id', '=', 1], ['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['payment_state', '=', 'not_paid'],
    ['partner_id.name', 'ilike', 'sumup'], ['ref', '=like', '%-______'], ['invoice_date', '>=', '2026-09-01'],
  ]], { fields: ['id', 'name', 'ref', 'amount_total'] })
  for (const f of factures) {
    const m = String(f.ref).match(/-(\d{4})(\d{2})$/)
    if (!m) continue
    const debut = `${m[1]}-${m[2]}-01`
    const fin = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10)
    const payable = [['company_id', '=', 1], ['parent_state', '=', 'posted'], ['account_id.account_type', '=', 'liability_payable'], ['reconciled', '=', false]]
    const fields = ['id', 'debit', 'credit', 'account_id']
    const [cote] = await odooRpc<any[]>('account.move.line', 'search_read', [[...payable, ['move_id', '=', f.id]]], { fields })
    const commissions = (await odooRpc<any[]>('account.move.line', 'search_read', [[...payable, ['name', 'ilike', 'Commission SumUp'], ['date', '>=', debut], ['date', '<=', fin]]], { fields, limit: 200 })).filter(l => l.debit > 0)
    const total = r2(commissions.reduce((s, l) => s + l.debit, 0))
    if (!cote || total !== r2(f.amount_total) || commissions.some(l => l.account_id[0] !== cote.account_id[0])) {
      out.aTrancher.push(`Frais SumUp ${f.name} : facture ${f.amount_total} €, commissions du mois ${total} €`)
      continue
    }
    await odooRpc('account.move.line', 'reconcile', [[cote.id, ...commissions.map(l => l.id)]])
    await journal({ agent: 'Rémi', company: 1, action: 'lettrage_frais_sumup', detail: `${f.name} (${f.ref}) lettrée avec ${commissions.length} commissions, ${total} €` })
    out.lettres.push(`Frais SumUp ${f.name} : ${total} €, ${commissions.length} commissions`)
  }
  return out
}
