// ============================================================
// VERVIERS DÉPANNAGE — Briques Odoo communes aux réconciliations
// ============================================================
//
// Paynovate et SumUp encaissent différemment mais atterrissent au même
// endroit dans Odoo : une facture client, un paiement dont la ligne 542
// attend d'être lettrée, et une ligne bancaire à basculer. Ces trois
// lectures étaient écrites dans `paynovate-match.ts` ; elles vivent ici
// depuis que SumUp les emprunte, à l'identique.

import { odooRpc } from '@/lib/odoo'

/** Compte « Paiements entrants en suspens » — le pivot de tous les lettrages. */
export const ACC_OUTSTANDING = 542

/** 499000 Suspense Accounts — où atterrissent les encaissements non affectés. */
export const ACC_UNALLOCATED = 265

/**
 * Les lignes d'OD des encaissements qu'on a décidé de ne pas affecter.
 *
 * Une transaction sans facture identifiable n'a aucun paiement carte à lettrer :
 * il manque son débit 542, et la ligne bancaire reste ouverte. Ces deux lignes
 * le fabriquent, en face du compte d'attente.
 *
 *     542 Paiements entrants en suspens   montant D   → rejoint le lettrage
 *     499000 Suspense Accounts            montant C   → reste à affecter
 *
 * Le commentaire saisi par l'utilisateur est repris tel quel dans le libellé :
 * c'est la seule chose lisible que le comptable aura en face du montant.
 */
export function unallocatedOdLines(
  txs: { amount: number; merchantRef: string; unallocated?: { amount: number; reason: string } | null }[],
  context: string,
): { account: number; label: string; debit: number; credit: number }[] {
  const out: { account: number; label: string; debit: number; credit: number }[] = []
  for (const t of txs) {
    if (!t.unallocated) continue
    const amount = round2(t.unallocated.amount || t.amount)
    if (amount <= 0.005) continue
    const label = `Encaissement non affecté — ${context}`
      + (t.merchantRef ? ` · réf. ${t.merchantRef}` : ' · sans référence')
      + ` — ${t.unallocated.reason}`
    out.push({ account: ACC_UNALLOCATED, label, debit: 0, credit: amount })
    out.push({ account: ACC_OUTSTANDING, label, debit: amount, credit: 0 })
  }
  return out
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** Les factures correspondant à une liste de numéros. */
export async function invoicesByName(names: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  if (!names.length) return map
  const rows = await odooRpc<any[]>('account.move', 'search_read', [[
    ['name', 'in', names],
  ]], {
    fields: ['id', 'name', 'partner_id', 'amount_total', 'amount_residual', 'payment_state', 'state', 'move_type'],
    limit: names.length + 50,
  })
  for (const r of rows) map.set(r.name, r)
  return map
}

/**
 * Le paiement Odoo qui solde chaque facture — c'est lui qu'on lettre contre la
 * ligne bancaire.
 *
 * ⚠️ Passer par `memo` ne marche pas : ce champ ne porte le numéro de facture
 * que pour les encaissements caisse. On interroge donc le lien réel,
 * `reconciled_invoice_ids`, qui vaut pour tous les paiements.
 */
export async function paymentsForInvoices(invoiceIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  if (!invoiceIds.length) return map
  const rows = await odooRpc<any[]>('account.payment', 'search_read', [[
    ['reconciled_invoice_ids', 'in', invoiceIds],
  ]], { fields: ['id', 'reconciled_invoice_ids'], limit: invoiceIds.length + 200 })
  for (const p of rows) {
    for (const inv of (p.reconciled_invoice_ids || [])) {
      if (!map.has(Number(inv))) map.set(Number(inv), p.id)
    }
  }
  return map
}

/**
 * Pourquoi le paiement d'une facture n'est plus disponible au lettrage.
 *
 * Un paiement carte dont la ligne 542 est déjà lettrée ailleurs bloque le
 * versement entier. Plutôt que d'annoncer « il manque X € », on remonte la
 * chaîne — lettrage → contrepartie → ligne bancaire — pour dire en clair
 * contre quoi il a été consommé. C'est presque toujours un double paiement :
 * la facture réglée par carte, puis re-réglée par virement.
 *
 * @returns paymentId → phrase explicative, pour les seuls paiements consommés.
 */
export async function explainConsumedPayments(paymentIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!paymentIds.length) return out

  const lines = await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['payment_id', 'in', paymentIds],
    ['account_id', '=', ACC_OUTSTANDING],
    ['reconciled', '=', true],
  ]], { fields: ['id', 'debit', 'payment_id', 'matched_credit_ids', 'matched_debit_ids'], limit: 200 })
  if (!lines.length) return out

  const partialIds = lines.flatMap(l => [...(l.matched_credit_ids || []), ...(l.matched_debit_ids || [])])
  if (!partialIds.length) return out

  const partials = await odooRpc<any[]>('account.partial.reconcile', 'read', [[...new Set(partialIds)]],
    { fields: ['id', 'amount', 'debit_move_id', 'credit_move_id', 'max_date'] })

  const idOf = (v: any) => (Array.isArray(v) ? Number(v[0]) : Number(v))
  const counterpartIds = new Set<number>()
  for (const p of partials) { counterpartIds.add(idOf(p.debit_move_id)); counterpartIds.add(idOf(p.credit_move_id)) }
  for (const l of lines) counterpartIds.delete(l.id)

  const counterparts = counterpartIds.size
    ? await odooRpc<any[]>('account.move.line', 'read', [[...counterpartIds]], { fields: ['id', 'move_id', 'name'] })
    : []
  const cpById = new Map(counterparts.map(c => [c.id, c]))

  // La contrepartie est-elle une ligne d'extrait ? Si oui, on cite le virement.
  const moveIds = [...new Set(counterparts.map(c => (Array.isArray(c.move_id) ? Number(c.move_id[0]) : Number(c.move_id))))]
  const stmt = moveIds.length
    ? await odooRpc<any[]>('account.bank.statement.line', 'search_read', [[['move_id', 'in', moveIds]]],
        { fields: ['id', 'date', 'amount', 'payment_ref', 'move_id'], limit: 100 })
    : []
  const stmtByMove = new Map(stmt.map(s => [Array.isArray(s.move_id) ? Number(s.move_id[0]) : Number(s.move_id), s]))

  for (const l of lines) {
    const pid = idOf(l.payment_id)
    const mine = partials.filter(p => idOf(p.debit_move_id) === l.id || idOf(p.credit_move_id) === l.id)
    for (const p of mine) {
      const otherId = idOf(p.debit_move_id) === l.id ? idOf(p.credit_move_id) : idOf(p.debit_move_id)
      const cp = cpById.get(otherId)
      if (!cp) continue
      const moveId = Array.isArray(cp.move_id) ? Number(cp.move_id[0]) : Number(cp.move_id)
      const s = stmtByMove.get(moveId)
      const jour = s ? String(s.date).split('-').reverse().join('/') : ''
      out.set(pid, s
        ? `son paiement de ${Number(l.debit).toFixed(2)} € a déjà été lettré contre le virement de ${Number(s.amount).toFixed(2)} € du ${jour} — la facture a donc été réglée deux fois`
        : `son paiement de ${Number(l.debit).toFixed(2)} € a déjà été lettré contre l'écriture ${Array.isArray(cp.move_id) ? cp.move_id[1] : moveId}`)
      break
    }
  }
  return out
}
