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

/** 757100 Positive Payment Differences — on a encaissé un centime de trop. */
export const ACC_ROUND_GAIN = 461
/** 657100 Negative Payment Differences — un centime de moins. */
export const ACC_ROUND_LOSS = 409

/**
 * Au-delà, ce n'est plus un arrondi mais un vrai écart, et c'est un humain qui
 * tranche. La TVA d'une facture ne décale jamais que d'un centime ou deux ;
 * cinq laisse de la marge sans rien laisser passer de significatif.
 */
export const ROUNDING_TOLERANCE = 0.05

/**
 * Les lignes d'OD qui absorbent les écarts d'arrondi.
 *
 * Le terminal encaisse 262,30 € pour une facture de 262,29 € : le paiement
 * n'apporte que 262,29 € de débit 542, et le lettrage tombe un centime court.
 * Ce centime doit exister quelque part, sinon la ligne bancaire reste ouverte
 * pour un centime — ce qui n'a aucun sens.
 */
export function roundingOdLines(
  txs: { amount: number; merchantRef: string; invoiceName?: string | null; rounding?: number | null }[],
  context: string,
): { account: number; label: string; debit: number; credit: number }[] {
  const out: { account: number; label: string; debit: number; credit: number }[] = []
  for (const t of txs) {
    const diff = round2(t.rounding || 0)
    if (!diff) continue
    const label = `Écart d'arrondi — ${context} · ${t.invoiceName || t.merchantRef || 'sans référence'}`
      + ` · encaissé ${t.amount.toFixed(2)} €`
    if (diff > 0) {
      // Encaissé plus que la facture : le débit 542 manquant, en produit.
      out.push({ account: ACC_OUTSTANDING, label, debit: diff, credit: 0 })
      out.push({ account: ACC_ROUND_GAIN,  label, debit: 0, credit: diff })
    } else {
      out.push({ account: ACC_ROUND_LOSS,  label, debit: -diff, credit: 0 })
      out.push({ account: ACC_OUTSTANDING, label, debit: 0, credit: -diff })
    }
  }
  return out
}

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
export interface InvoicePayment { id: number; amount: number }

export async function paymentsForInvoices(invoiceIds: number[]): Promise<Map<number, InvoicePayment[]>> {
  const map = new Map<number, InvoicePayment[]>()
  if (!invoiceIds.length) return map
  const rows = await odooRpc<any[]>('account.payment', 'search_read', [[
    ['reconciled_invoice_ids', 'in', invoiceIds],
  ]], { fields: ['id', 'amount', 'reconciled_invoice_ids'], limit: invoiceIds.length + 200 })
  for (const p of rows) {
    for (const inv of (p.reconciled_invoice_ids || [])) {
      const key = Number(inv)
      map.set(key, [...(map.get(key) || []), { id: Number(p.id), amount: Number(p.amount) || 0 }])
    }
  }
  // Tri déterministe : jamais l'ordre de retour d'Odoo.
  for (const list of map.values()) list.sort((a, b) => a.id - b.id)
  return map
}

/**
 * Quels paiements lettrer pour une transaction, parmi ceux de ses factures.
 *
 * Une facture peut être réglée en PLUSIEURS FOIS — 220 € payés 200 € en espèces
 * et 20 € par carte. L'encaissement carte ne vaut alors pas le total de la
 * facture, et le comparer à ce total le faisait passer pour un écart de
 * montant. On cherche donc d'abord le paiement qui vaut exactement la
 * transaction ; à défaut, on prend tous ceux de la ou des factures.
 *
 * `taken` évite que deux transactions du même versement se disputent le même
 * paiement — il est complété au fur et à mesure par l'appelant.
 */
export function choosePayments(
  amount: number,
  payableIds: number[],
  byInvoice: Map<number, InvoicePayment[]>,
  taken: Set<number>,
): { ids: number[]; total: number; exact: boolean } {
  const pool = [...new Map(
    payableIds.flatMap(id => (byInvoice.get(id) || []).map(p => [p.id, p] as const)),
  ).values()].filter(p => !taken.has(p.id))

  const exact = pool.find(p => Math.abs(p.amount - amount) < 0.005)
  const picked = exact ? [exact] : pool
  return {
    ids:   picked.map(p => p.id),
    total: round2(picked.reduce((s, p) => s + p.amount, 0)),
    exact: !!exact,
  }
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

/**
 * Le message utile d'une erreur Odoo, sans la pile d'exécution.
 *
 * Un refus d'Odoo remonte sous forme de JSON contenant `data.message` (la
 * phrase lisible, souvent une UserError) ET `data.debug` (quarante lignes de
 * traceback Python). Affichée telle quelle dans l'écran, c'est illisible et ça
 * recouvre la page. On ne garde que la phrase.
 */
export function humanOdooError(e: unknown): string {
  const raw = String((e as any)?.message ?? e ?? '')
  const start = raw.indexOf('{')
  if (start >= 0) {
    try {
      const payload = JSON.parse(raw.slice(start))
      const msg = payload?.data?.message ?? payload?.message
      if (msg) return String(msg).split('\n')[0].trim().slice(0, 300)
    } catch { /* pas du JSON : on retombe sur le brut tronqué */ }
  }
  return raw.split('\n')[0].trim().slice(0, 300)
}
