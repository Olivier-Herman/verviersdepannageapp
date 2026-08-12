// ============================================================
// VERVIERS DÉPANNAGE — Rapprochement des versements Paynovate
// ============================================================
//
// Le moteur. Il ne fait que CALCULER : aucune écriture Odoo n'est produite
// ici, c'est la validation dans l'écran qui déclenchera l'écriture.
//
// Chaîne :
//   ligne bancaire non lettrée (Odoo)
//     └─ libellé « … PAYMENT 391958542 » → identifiant de versement
//         └─ transactions du versement (Paynovate)
//             └─ « Merchant Reference » = n° de facture Odoo
//                 └─ facture + paiement en suspens à lettrer
//
// Quatre états possibles par versement :
//   ready — tout concorde, un clic suffit
//   lost  — la facture est encore ouverte alors que le client a payé
//   gap   — le montant encaissé ne colle pas à la facture
//   miss  — la référence ne correspond à aucune facture
//
// Un versement dont une seule transaction cloche reste bloqué en entier :
// lettrer à moitié une ligne bancaire fausserait le solde du compte.

import { odooRpc } from '@/lib/odoo'
import {
  fetchAllTransactions,
  paymentIdFromLabel,
  tidFromLabel,
  type PaynovateTx,
} from '@/lib/paynovate'
import { resolveReference, type Confidence } from '@/lib/paynovate-resolve'

export type MatchState = 'ready' | 'lost' | 'gap' | 'miss'

export interface MatchedTx {
  merchantRef:  string
  amount:       number          // montant encaissé sur le terminal
  cardBrand:    string
  at:           string | null
  commission:   number          // TVAC — c'est ce montant qui part en OD
  confidence:   Confidence      // comment la facture a été retrouvée
  explanation:  string          // en clair, pour l'écran
  invoiceIds:   number[]        // plusieurs si un paiement couvre plusieurs factures
  invoiceName:  string | null
  partner:      string | null
  invoiceTotal: number | null
  paymentState: string | null   // 'paid' | 'not_paid' | 'partial' | …
  paymentId:    number | null   // le paiement Odoo à lettrer, s'il existe
  candidates:   { id: number; name: string; partner: string; amount: number; date: string }[]
  issue:        'lost' | 'gap' | 'miss' | null
}

export interface MatchedPayout {
  state:        MatchState
  paymentId:    number          // identifiant du versement Paynovate
  tid:          string | null
  terminal:     string | null   // nom du compte marchand
  bankLineId:   number
  bankMoveName: string
  bankDate:     string
  bankAmount:   number          // net crédité
  grossAmount:  number          // brut encaissé
  commission:   number          // brut − net, TVAC
  txs:          MatchedTx[]
  blocking:     string[]        // ce qui empêche le rapprochement, en clair
}

export interface MatchReport {
  payouts:   MatchedPayout[]
  unmatched: { bankLineId: number; date: string; amount: number; label: string; reason: string }[]
  totals: {
    count: number
    amount: number
    byState: Record<MatchState, { count: number; amount: number }>
    lostInvoices: number
    lostAmount: number
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Les lignes bancaires Paynovate encore à lettrer. */
async function unreconciledPaynovateLines(): Promise<any[]> {
  return odooRpc<any[]>('account.bank.statement.line', 'search_read', [[
    ['is_reconciled', '=', false],
    ['payment_ref', 'ilike', 'PAYNOVATE'],
  ]], {
    fields: ['id', 'date', 'amount', 'payment_ref', 'move_id', 'journal_id'],
    order: 'date desc, id desc',      // le plus récent en haut de la file
    limit: 500,
  })
}

/** Les factures correspondant à une liste de numéros. */
async function invoicesByName(names: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  if (!names.length) return map
  const rows = await odooRpc<any[]>('account.move', 'search_read', [[
    ['name', 'in', names],
  ]], {
    fields: ['id', 'name', 'partner_id', 'amount_total', 'amount_residual', 'payment_state', 'state'],
    limit: names.length + 50,
  })
  for (const r of rows) map.set(r.name, r)
  return map
}

/** Les paiements Odoo déjà enregistrés pour ces factures (à lettrer contre la banque). */
async function paymentsByMemo(names: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  if (!names.length) return map
  const rows = await odooRpc<any[]>('account.payment', 'search_read', [[
    ['memo', 'in', names],
  ]], { fields: ['id', 'memo', 'amount', 'journal_id', 'payment_method_line_id'], limit: names.length + 50 })
  for (const r of rows) if (!map.has(r.memo)) map.set(r.memo, r)
  return map
}

/**
 * Construit le rapport de rapprochement.
 *
 * @param monthsBack profondeur de l'export Paynovate. La fenêtre porte sur la
 *   date de VERSEMENT, donc on remonte large : une ligne bancaire d'aujourd'hui
 *   peut porter des transactions de plusieurs semaines en arrière.
 */
export async function buildMatchReport(monthsBack = 5): Promise<MatchReport> {
  const lines = await unreconciledPaynovateLines()

  const to   = new Date()
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - monthsBack, 1))
  const txs  = await fetchAllTransactions(from, to)

  // Index des transactions par versement.
  const byPayout = new Map<number, PaynovateTx[]>()
  for (const t of txs) {
    const arr = byPayout.get(t.paymentId) ?? []
    arr.push(t)
    byPayout.set(t.paymentId, arr)
  }

  // Chemin rapide : les références déjà au format facture (72 % des cas) se
  // lisent en une seule requête. Le reste passe par le résolveur, un par un.
  const exactRefs = new Set<string>()
  for (const l of lines) {
    const pid = paymentIdFromLabel(l.payment_ref)
    if (!pid) continue
    for (const t of byPayout.get(pid) ?? []) {
      if (/^\d{4}\/\d{2}\/\d{3,4}$/.test(t.merchantRef.trim())) exactRefs.add(t.merchantRef.trim())
    }
  }
  const invoices = await invoicesByName([...exactRefs])

  const resolved = new Map<string, Awaited<ReturnType<typeof resolveReference>>>()

  const payouts: MatchReport['payouts'] = []
  const unmatched: MatchReport['unmatched'] = []

  for (const line of lines) {
    const pid = paymentIdFromLabel(line.payment_ref)
    if (!pid) {
      unmatched.push({
        bankLineId: line.id, date: line.date, amount: line.amount,
        label: String(line.payment_ref || '').slice(0, 120),
        reason: 'Pas d\'identifiant de versement dans le libellé bancaire',
      })
      continue
    }

    const group = byPayout.get(pid)
    if (!group?.length) {
      unmatched.push({
        bankLineId: line.id, date: line.date, amount: line.amount,
        label: String(line.payment_ref || '').slice(0, 120),
        reason: `Versement ${pid} absent de l'export Paynovate (hors fenêtre ?)`,
      })
      continue
    }

    const matched: MatchedTx[] = []
    for (const t of group) {
      const ref = t.merchantRef.trim()
      const inv = invoices.get(ref)

      // Chemin rapide, puis résolveur (avec cache : la même plaque revient).
      let confidence: Confidence = 'aucun'
      let explanation = ''
      let candidates: MatchedTx['candidates'] = []
      let hits: any[] = []

      if (inv) {
        confidence  = 'exact'
        explanation = `Facture ${ref}`
        hits        = [inv]
      } else {
        const key = `${ref}|${t.rawAmount}`
        const r = resolved.get(key) ?? await resolveReference(ref, t.rawAmount, t.transactionAt)
        resolved.set(key, r)
        confidence  = r.confidence
        explanation = r.explanation
        candidates  = r.candidates
        hits        = r.candidates.filter(c => r.invoiceIds.includes(c.id))
      }

      const sure  = confidence === 'exact' || confidence === 'corrige' || confidence === 'plaque'
      const total = hits.reduce((s, h) => s + Number(h.amount ?? h.amount_total ?? 0), 0)
      const state = hits.length === 1 ? (hits[0].payment_state ?? null) : null

      let issue: MatchedTx['issue'] = null
      if (!sure || !hits.length) issue = 'miss'
      else if (Math.abs(total - t.rawAmount) > 0.005) issue = 'gap'
      else if (state && state !== 'paid' && state !== 'in_payment') issue = 'lost'

      matched.push({
        merchantRef:  t.merchantRef,
        amount:       t.rawAmount,
        cardBrand:    t.cardBrand,
        at:           t.transactionAt,
        commission:   t.commissionTvac,
        confidence,
        explanation,
        invoiceIds:   hits.map(h => h.id),
        invoiceName:  hits.length === 1 ? (hits[0].name ?? null) : hits.map(h => h.name).join(' + ') || null,
        partner:      hits.length ? (hits[0].partner ?? (Array.isArray(hits[0].partner_id) ? hits[0].partner_id[1] : null)) : null,
        invoiceTotal: hits.length ? round2(total) : null,
        paymentState: state,
        paymentId:    null,
        candidates,
        issue,
      })
    }

    // Les paiements Odoo déjà enregistrés, à lettrer contre la ligne bancaire.
    const names = matched.map(m => m.invoiceName).filter((n): n is string => !!n && !n.includes(' + '))
    const payments = await paymentsByMemo(names)
    for (const m of matched) if (m.invoiceName) m.paymentId = payments.get(m.invoiceName)?.id ?? null

    const gross      = round2(group.reduce((s, t) => s + t.rawAmount, 0))
    const commission = round2(gross - Number(line.amount))

    const blocking: string[] = []
    for (const m of matched) {
      if (m.issue === 'miss') blocking.push(m.explanation || `Référence « ${m.merchantRef} » non résolue`)
      if (m.issue === 'gap')  blocking.push(`${m.invoiceName || m.merchantRef} : encaissé ${m.amount.toFixed(2)} € pour une facture de ${(m.invoiceTotal ?? 0).toFixed(2)} €`)
      if (m.issue === 'lost') blocking.push(`${m.invoiceName} (${m.partner || '?'}) : facture encore ouverte alors qu'elle est payée`)
    }

    // Contrôle de cohérence : le brut Paynovate doit couvrir le net crédité.
    if (gross + 0.005 < Number(line.amount)) {
      blocking.push(`Incohérence : brut ${gross.toFixed(2)} € inférieur au net crédité ${Number(line.amount).toFixed(2)} €`)
    }

    const state: MatchState =
      matched.some(m => m.issue === 'miss') ? 'miss'
      : matched.some(m => m.issue === 'gap')  ? 'gap'
      : matched.some(m => m.issue === 'lost') ? 'lost'
      : 'ready'

    payouts.push({
      state,
      paymentId:    pid,
      tid:          tidFromLabel(line.payment_ref) ?? group[0]?.tid ?? null,
      terminal:     null,
      bankLineId:   line.id,
      bankMoveName: Array.isArray(line.move_id) ? line.move_id[1] : '',
      bankDate:     line.date,
      bankAmount:   Number(line.amount),
      grossAmount:  gross,
      commission,
      txs:          matched,
      blocking,
    })
  }

  const byState = { ready: { count: 0, amount: 0 }, lost: { count: 0, amount: 0 }, gap: { count: 0, amount: 0 }, miss: { count: 0, amount: 0 } }
  for (const p of payouts) {
    byState[p.state].count += 1
    byState[p.state].amount = round2(byState[p.state].amount + p.bankAmount)
  }
  const lost = payouts.flatMap(p => p.txs).filter(t => t.issue === 'lost')

  return {
    payouts,
    unmatched,
    totals: {
      count:  payouts.length,
      amount: round2(payouts.reduce((s, p) => s + p.bankAmount, 0)),
      byState,
      lostInvoices: lost.length,
      lostAmount:   round2(lost.reduce((s, t) => s + t.amount, 0)),
    },
  }
}
