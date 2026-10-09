// src/lib/agents/lot2.ts
//
// Lot 2 de Florent (Olivier 05/10/2026, « ok ») : briques ERP réutilisées par
// les exécutions. Toujours sur la société visée (odooRpcCompany) — sauf les
// rapprochements Paynovate / SumUp / assureurs, qui sont de Verviers Dépannage
// et reprennent EXACTEMENT les fonctions du bouton « Rapprocher ».

import { odooRpc, odooRpcCompany } from '@/lib/odoo'
import { createAdminClient } from '@/lib/supabase'
import { getBusinessNumber } from '@/lib/settings/business'

const r2 = (n: number) => Math.round(n * 100) / 100

/** Plaque normalisée comme dans VD Soft : sans tirets, espaces ni points, en majuscules. */
export const normPlate = (s: string) => String(s || '').replace(/[\s.\-]/g, '').toUpperCase()

/** Véhicule du parc de l'ERP pour une plaque (champ « Plaque » = x_studio_plaque_1). */
export async function vehicleForPlate(company: number, plate: string): Promise<{ id: number; name: string } | null> {
  const p = normPlate(plate)
  if (p.length < 4) return null
  const v: any[] = await odooRpcCompany(company, 'fleet.vehicle', 'search_read', [[['license_plate', '=', p]]], { fields: ['id', 'display_name'], limit: 2 })
  if (v.length === 1) return { id: v[0].id, name: v[0].display_name }
  if (v.length > 1) return null
  // Plaque enregistrée avec tirets, points ou espaces (« 1-ABC-123 ») : même plaque une fois normalisée.
  const loose: any[] = await odooRpcCompany(company, 'fleet.vehicle', 'search_read', [[['license_plate', 'ilike', p.slice(-4)]]], { fields: ['id', 'display_name', 'license_plate'], limit: 50 })
  const same = loose.filter(x => normPlate(x.license_plate) === p)
  return same.length === 1 ? { id: same[0].id, name: same[0].display_name } : null
}

/** Fournisseur au vrai nom : retrouvé, sinon créé (jamais de fournisseur générique — Olivier 05/10/2026). */
export async function ensureSupplier(company: number, name: string): Promise<{ id: number; created: boolean }> {
  const n = String(name || '').trim()
  if (n.length < 2) throw new Error('Nom du fournisseur manquant.')
  const found: any[] = await odooRpcCompany(company, 'res.partner', 'search_read', [[['name', '=ilike', n]]], { fields: ['id'], limit: 2 })
  if (found.length === 1) return { id: found[0].id, created: false }
  if (found.length > 1) throw new Error(`Plusieurs fiches « ${n} » dans l'ERP : à trancher à la main.`)
  const id = await odooRpcCompany<number>(company, 'res.partner', 'create', [{ name: n, is_company: true, supplier_rank: 1 }])
  return { id, created: true }
}

/**
 * Éclate la contrepartie d'attente d'une ligne de banque et la lettre.
 * `parts` : une part par document (facture, ou compte fournisseur sans lettrage).
 * Même chemin qu'Odoo 19 accepte pour les assureurs : brouillon → écriture
 * unique sur la pièce → revalidation → lettrage un à un.
 */
export async function splitBankLine(company: number, bankLineId: number, parts: { amount: number; accountId: number; partnerId: number | false; label: string; match: number[] }[]): Promise<void> {
  const [line] = await odooRpcCompany<any[]>(company, 'account.bank.statement.line', 'read', [[bankLineId]], { fields: ['move_id', 'journal_id', 'amount', 'is_reconciled', 'company_id'] })
  if (!line || line.company_id?.[0] !== company) throw new Error('Ligne de banque introuvable dans cette société.')
  if (line.is_reconciled) throw new Error('Ligne de banque déjà rapprochée.')
  const [journal] = await odooRpcCompany<any[]>(company, 'account.journal', 'read', [[line.journal_id[0]]], { fields: ['suspense_account_id'] })
  const suspenseAcc = journal?.suspense_account_id?.[0]
  const moveId = line.move_id[0]
  const sus: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', moveId], ['account_id', '=', suspenseAcc]]], { fields: ['id'], limit: 2 })
  if (sus.length !== 1) throw new Error('La contrepartie de cette ligne n’est plus en compte d’attente : déjà touchée.')
  const sum = r2(parts.reduce((s, p) => s + p.amount, 0))
  if (Math.abs(sum - r2(line.amount)) > 0.005) throw new Error(`Montant : ${sum.toFixed(2)} € à répartir pour une ligne de ${Number(line.amount).toFixed(2)} €.`)
  const cmd = (x: typeof parts[number]) => ({ account_id: x.accountId, partner_id: x.partnerId, name: x.label, debit: x.amount < 0 ? -x.amount : 0, credit: x.amount > 0 ? x.amount : 0, amount_currency: -x.amount })
  await odooRpcCompany(company, 'account.move', 'button_draft', [[moveId]])
  try {
    await odooRpcCompany(company, 'account.move', 'write', [[moveId], { line_ids: [[1, sus[0].id, cmd(parts[0])], ...parts.slice(1).map(x => [0, 0, cmd(x)])] }])
  } finally {
    await odooRpcCompany(company, 'account.move', 'action_post', [[moveId]])
  }
  const fresh: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', moveId], ['account_id', 'in', [...new Set(parts.map(p => p.accountId))]]]], { fields: ['id', 'name'], order: 'id' })
  for (const x of parts) {
    if (!x.match.length) continue
    const i = fresh.findIndex(l => l.name === x.label)
    if (i < 0) throw new Error(`Ligne « ${x.label} » introuvable après éclatement.`)
    const [l] = fresh.splice(i, 1)
    await odooRpcCompany(company, 'account.move.line', 'reconcile', [[l.id, ...x.match]])
  }
}

/** Parts « une par facture » : reste dû exact de chaque facture (client ou fournisseur). */
export async function invoiceParts(company: number, invoiceIds: number[]) {
  const moves: any[] = await odooRpcCompany(company, 'account.move', 'read', [invoiceIds], { fields: ['id', 'name', 'state', 'company_id', 'commercial_partner_id', 'move_type'] })
  if (moves.length !== invoiceIds.length || moves.some(m => m.state !== 'posted' || m.company_id?.[0] !== company)) throw new Error('Pièces introuvables, pas validées ou d’une autre société.')
  const open: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', 'in', invoiceIds], ['account_id.account_type', 'in', ['asset_receivable', 'liability_payable']], ['reconciled', '=', false]]], { fields: ['id', 'move_id', 'account_id', 'amount_residual'] })
  return moves.map(m => {
    const ls = open.filter(l => l.move_id[0] === m.id)
    if (!ls.length) throw new Error(`${m.name} est déjà soldée.`)
    return { amount: r2(ls.reduce((s, l) => s + Number(l.amount_residual || 0), 0)), accountId: ls[0].account_id[0], partnerId: m.commercial_partner_id?.[0] || false, label: `${m.name} — ${m.commercial_partner_id?.[1] || ''}`.slice(0, 120), match: ls.map(l => l.id) }
  })
}

/** Rapprochement d'un versement « Prêt » / « Encaissement perdu » : les fonctions du bouton, à l'identique. */
export async function reconcileSource(source: 'paynovate' | 'sumup' | 'assureur', id: number, actorId: string | null): Promise<string> {
  const sb = createAdminClient()
  const { humanOdooError } = await import('@/lib/reconcile-odoo')
  if (source === 'assureur') {
    const { buildAdviceReport } = await import('@/lib/advice-match')
    const { buildAdvicePlan, postAdvicePlan } = await import('@/lib/advice-post')
    const { data: d } = await sb.from('payout_reconciliations').select('id').in('provider', ['ima', 'awp', 'communication']).eq('status', 'done').eq('bank_line_id', id).limit(1)
    if (d?.length) throw new Error('Virement déjà rapproché.')
    const report = await buildAdviceReport(2)
    const item = report.items.find(i => i.bank?.lineId === id)
    if (!item) throw new Error('Virement introuvable.')
    if (item.state !== 'ready') throw new Error(item.blocking[0] || `état « ${item.state} »`)
    const plan = buildAdvicePlan(item)
    try {
      const { reconciled, paymentIds } = await postAdvicePlan(plan)
      await sb.from('payout_reconciliations').insert({ provider: item.payer, payout_ref: item.advice?.reference || `${item.payer}-${id}`, customer_ref: item.payerLabel, payout_date: plan.bankDate, gross_amount: plan.amount, net_amount: plan.amount, commission_amount: 0, bank_line_id: plan.bankLineId, invoice_ids: plan.invoiceIds, payment_ids: paymentIds, reconciled_by: actorId, payload: { item, plan, par: 'agent' } })
      return `${item.payerLabel} ${plan.amount.toFixed(2)} € rapproché (${reconciled} facture${reconciled > 1 ? 's' : ''})`
    } catch (e) { throw new Error(humanOdooError(e)) }
  }
  const { postPlan } = await import('@/lib/paynovate-post')
  const { data: prev } = await sb.from('payout_reconciliations').select('id').eq('provider', source).eq('payout_ref', String(id)).eq('status', 'done').limit(1)
  let payout: any, plan: any
  if (source === 'paynovate') {
    const { buildMatchReport } = await import('@/lib/paynovate-match')
    const { buildPostingPlan } = await import('@/lib/paynovate-post')
    payout = (await buildMatchReport(5, { onlyPayouts: [id] })).payouts.find(p => p.paymentId === id)
    if (!payout) throw new Error('Versement introuvable.')
    if (payout.state !== 'ready' && payout.state !== 'lost') throw new Error(`Versement à trancher (${payout.blocking[0] || payout.state}).`)
    plan = buildPostingPlan(payout)
  } else {
    const { buildSumupMatchReport } = await import('@/lib/sumup-match')
    const { buildSumupPostingPlan } = await import('@/lib/sumup-post')
    payout = (await buildSumupMatchReport(5, { onlyPayouts: [id] })).payouts.find(p => p.paymentId === id)
    if (!payout) throw new Error('Versement introuvable.')
    if (payout.state !== 'ready' && payout.state !== 'lost') throw new Error(`Versement à trancher (${payout.blocking[0] || payout.state}).`)
    plan = buildSumupPostingPlan(payout, await getBusinessNumber('odoo_partner_sumup'))
  }
  try {
    const { odMoveId } = await postPlan(plan)
    if (prev?.length) await sb.from('payout_reconciliations').update({ status: 'reverted', reverted_at: new Date().toISOString() }).eq('id', prev[0].id)
    await sb.from('payout_reconciliations').insert({ provider: source, payout_ref: String(id), customer_ref: payout.terminal, terminal_tid: source === 'paynovate' ? payout.tid : null, payout_date: payout.bankDate, gross_amount: plan.gross, net_amount: plan.net, commission_amount: plan.commission, bank_line_id: plan.bankLineId, od_move_id: odMoveId, invoice_ids: plan.invoiceIds, payment_ids: plan.paymentIds, reconciled_by: actorId, payload: { payout, plan, par: 'agent' } })
    return `${source === 'paynovate' ? 'Paynovate' : 'SumUp'} ${id} rapproché (${plan.gross?.toFixed?.(2) ?? plan.gross} € brut, OD ${odMoveId})`
  } catch (e) { throw new Error(humanOdooError(e)) }
}

/** Taxes de chaque ligne recalculées selon la position fiscale de la pièce (la correspondance se lit sur les taxes). */
export async function remapTaxes(company: number, moveId: number): Promise<string[]> {
  const [m] = await odooRpcCompany<any[]>(company, 'account.move', 'read', [[moveId]], { fields: ['fiscal_position_id', 'state'] })
  const fp = m?.fiscal_position_id?.[0]
  const lines: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', moveId], ['display_type', '=', 'product']]], { fields: ['id', 'tax_ids'] })
  if (!fp) return []
  const mapped: any[] = await odooRpcCompany(company, 'account.tax', 'search_read', [[['fiscal_position_ids', 'in', [fp]]]], { fields: ['id', 'name', 'amount', 'original_tax_ids'] })
  const notes: string[] = []
  for (const l of lines) {
    const next = l.tax_ids.map((t: number) => mapped.find(x => (x.original_tax_ids || []).includes(t))?.id ?? t)
    if (JSON.stringify(next) !== JSON.stringify(l.tax_ids)) {
      await odooRpcCompany(company, 'account.move', 'write', [[moveId], { invoice_line_ids: [[1, l.id, { tax_ids: [[6, 0, next]] }]] }])
      notes.push(`ligne ${l.id} : taxes ${l.tax_ids.join(',')} → ${next.join(',')}`)
    }
  }
  return notes
}

export { odooRpc }
