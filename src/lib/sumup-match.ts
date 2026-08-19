// ============================================================
// VERVIERS DÉPANNAGE — Rapprochement des versements SumUp
// ============================================================
//
// Même moteur que Paynovate, mêmes états, mêmes garde-fous — seule la source
// change. Il ne fait que CALCULER : rien n'est écrit dans Odoo ici.
//
// Chaîne :
//   ligne bancaire non lettrée (Odoo, journal de banque)
//     └─ libellé « … Communication : MC7 PID1332537 »
//         └─ transactions du versement (API SumUp)
//             └─ référence terminal (jeton VD Soft, plaque, n° de facture)
//                 └─ facture + paiement en suspens à lettrer
//
// Le paiement à lettrer existe presque toujours : l'app enregistre déjà
// l'encaissement dans Odoo sur le journal « Encaissement Chauffeur », méthode
// « Sumup », **au montant brut**, et sa ligne 542 reste en attente. C'est
// exactement ce que le lettrage vient consommer.
//
// Un versement dont une seule transaction cloche reste bloqué en entier :
// lettrer à moitié une ligne bancaire fausserait le solde du compte.

import { odooRpc } from '@/lib/odoo'
import {
  fetchPayoutTransactions,
  payoutRefFromLabel,
  payoutIdOf,
  type SumUpTx,
} from '@/lib/sumup-payouts'
import { loadTokenIndex, readInvoices, resolveSumupReference } from '@/lib/sumup-resolve'
import { isRefund, signedTotal, type Confidence } from '@/lib/paynovate-resolve'
import type { MatchedTx, MatchedPayout, MatchReport, MatchState } from '@/lib/paynovate-match'
import {
  round2,
  invoicesByName,
  paymentsForInvoices,
  choosePayments,
  explainConsumedPayments,
  ROUNDING_TOLERANCE,
} from '@/lib/reconcile-odoo'
import { loadUnallocated, findUnallocated } from '@/lib/payout-unallocated'

const INVOICE_RE = /^\d{4}\/\d{2}\/\d{3,4}$/

/**
 * Les lignes bancaires SumUp encore à lettrer.
 *
 * ⚠️ Le filtre sur le TYPE du journal n'est pas décoratif : une OD manuelle
 * intitulée « Commission Sumup » traîne sur le journal Opérations Diverses.
 * Sans ce filtre elle remontait dans la file comme un versement de 1 000 €.
 */
async function unreconciledSumupLines(): Promise<any[]> {
  return odooRpc<any[]>('account.bank.statement.line', 'search_read', [[
    ['is_reconciled', '=', false],
    ['payment_ref', 'ilike', 'SumUp'],
    ['journal_id.type', '=', 'bank'],
  ]], {
    fields: ['id', 'date', 'amount', 'payment_ref', 'move_id', 'journal_id'],
    order: 'date desc, id desc',      // le plus récent en haut de la file
    limit: 500,
  })
}

/**
 * Construit le rapport de rapprochement SumUp.
 *
 * @param monthsBack profondeur de lecture chez SumUp. La fenêtre porte sur la
 *   date de VERSEMENT : une transaction du 14 peut n'être versée que le 17.
 */
export async function buildSumupMatchReport(
  monthsBack = 5,
  opts: { onlyPayouts?: number[] } = {},
): Promise<MatchReport> {
  let lines = await unreconciledSumupLines()

  // Vérification ciblée (validation d'un versement) : on ne résout que celui-là.
  if (opts.onlyPayouts?.length) {
    const wanted = new Set(opts.onlyPayouts.map(Number))
    lines = lines.filter(l => {
      const ref = payoutRefFromLabel(l.payment_ref)
      const id  = ref ? payoutIdOf(ref) : null
      return id !== null && wanted.has(id)
    })
  }

  const to   = new Date()
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - monthsBack, 1))
  const txs  = await fetchPayoutTransactions(from, to)

  // Index des transactions par versement.
  const byPayout = new Map<number, SumUpTx[]>()
  for (const t of txs) {
    const arr = byPayout.get(t.payoutId) ?? []
    arr.push(t)
    byPayout.set(t.payoutId, arr)
  }

  // Les références du lot, résolues en bloc avant la boucle : les jetons VD
  // Soft en trois requêtes, les numéros de facture en une. Le reste, un par un.
  const refsInPlay: string[] = []
  for (const l of lines) {
    const ref = payoutRefFromLabel(l.payment_ref)
    const id  = ref ? payoutIdOf(ref) : null
    if (id === null) continue
    for (const t of byPayout.get(id) ?? []) if (t.merchantRef) refsInPlay.push(t.merchantRef)
  }

  // Les lignes qu'on a décidé de passer en OD : elles ne bloquent plus rien.
  const linkKeys: string[] = []
  for (const l of lines) {
    const ref = payoutRefFromLabel(l.payment_ref)
    const id  = ref ? payoutIdOf(ref) : null
    if (id === null) continue
    for (const t of byPayout.get(id) ?? []) linkKeys.push(t.merchantRef.trim() || t.transactionCode)
  }
  const unallocated = await loadUnallocated('sumup', linkKeys)

  const tokenIndex   = await loadTokenIndex(refsInPlay)
  const invoiceCache = await readInvoices(
    [...tokenIndex.values()].map(h => h.invoiceId).filter((n): n is number => !!n),
  )
  const invoices = await invoicesByName(
    [...new Set(refsInPlay.map(r => r.trim()).filter(r => INVOICE_RE.test(r)))],
  )

  const resolved = new Map<string, Awaited<ReturnType<typeof resolveSumupReference>>>()

  const payouts: MatchReport['payouts'] = []
  const unmatched: MatchReport['unmatched'] = []

  for (const line of lines) {
    const ref = payoutRefFromLabel(line.payment_ref)
    const pid = ref ? payoutIdOf(ref) : null
    if (pid === null) {
      unmatched.push({
        bankLineId: line.id, date: line.date, amount: line.amount,
        label: String(line.payment_ref || '').slice(0, 120),
        reason: 'Pas de communication « MC7 PID… » dans le libellé bancaire',
      })
      continue
    }

    const group = byPayout.get(pid)
    if (!group?.length) {
      unmatched.push({
        bankLineId: line.id, date: line.date, amount: line.amount,
        label: String(line.payment_ref || '').slice(0, 120),
        reason: `Versement ${ref} absent de l'API SumUp (hors fenêtre ?)`,
      })
      continue
    }

    const matched: MatchedTx[] = []
    for (const t of group) {
      const r = t.merchantRef.trim()
      // Sans référence au terminal (« Montant personnalisé »), un rattachement
      // manuel se cale sur le code de la transaction : il est unique et stable.
      // L'enregistrer sous la clé vide le ferait s'appliquer à tort à tous les
      // encaissements suivants du même montant.
      const linkKey = r || t.transactionCode
      const inv = INVOICE_RE.test(r) ? invoices.get(r) : undefined

      let confidence: Confidence = 'aucun'
      let explanation = ''
      let candidates: MatchedTx['candidates'] = []
      let manual = false
      let hits: any[] = []

      if (inv) {
        confidence  = 'exact'
        explanation = `Facture ${r}`
        hits        = [inv]
      } else {
        const key = `${linkKey}|${t.rawAmount}`
        const res = resolved.get(key)
          ?? await resolveSumupReference(r, t.rawAmount, t.transactionAt, tokenIndex, invoiceCache, linkKey)
        resolved.set(key, res)
        confidence  = res.confidence
        explanation = res.explanation
        candidates  = res.candidates
        manual      = !!res.manual
        hits        = res.candidates.filter(c => res.invoiceIds.includes(c.id))
      }

      const sure  = confidence === 'exact' || confidence === 'corrige' || confidence === 'plaque'
      // Signé : une note de crédit rattachée vient EN DÉDUCTION de l'encaissement.
      const total = hits.reduce((s, h) => s + signedTotal(h), 0)
      const state = hits.length === 1 ? (hits[0].payment_state ?? null) : null
      const moveState = hits.length === 1 ? (hits[0].state ?? null) : null

      let issue: MatchedTx['issue'] = null
      if (!sure || !hits.length) issue = 'miss'
      else if (Math.abs(total - t.rawAmount) > 0.005) issue = 'gap'
      else if (moveState === 'draft') issue = 'draft'
      else if (state && state !== 'paid' && state !== 'in_payment') issue = 'lost'

      // Décision humaine : cette ligne part en OD. Elle cesse de bloquer, et le
      // plan d'écriture produira le débit 542 qui manque. On efface aussi la
      // facture éventuellement devinée : c'est le compte d'attente qui encaisse,
      // pas elle — sinon le plan lettrerait un paiement qui n'existe pas.
      const od = findUnallocated(unallocated, linkKey, t.rawAmount)

      matched.push({
        merchantRef:  t.merchantRef,
        linkKey,
        amount:       t.rawAmount,
        cardBrand:    t.cardBrand,
        at:           t.transactionAt,
        commission:   t.commission,
        confidence,
        explanation,
        // Passée en OD : c'est le compte d'attente qui encaisse, pas une
        // facture. On efface celle qui aurait pu être devinée, sinon le plan
        // chercherait à lettrer un paiement qui ne la concerne pas.
        invoiceIds:   od ? [] : hits.map(h => h.id),
        invoiceName:  od ? null : (hits.length === 1 ? (hits[0].name ?? null) : hits.map(h => h.name).join(' + ') || null),
        partner:      od || !hits.length ? null : (hits[0].partner ?? (Array.isArray(hits[0].partner_id) ? hits[0].partner_id[1] : null)),
        invoiceTotal: od || !hits.length ? null : round2(total),
        paymentState: od ? null : state,
        paymentId:    null,
        paymentIds:   [],
        payableIds:   hits.filter(h => !isRefund(h.move_type)).map(h => h.id),
        candidates,
        manual,
        issue:        od ? null : issue,
        by:           t.by,
        unallocated:  od ? { amount: od.amount, reason: od.reason } : null,
      })
    }

    // Les paiements Odoo déjà enregistrés, à lettrer contre la ligne bancaire.
    //
    // On alloue transaction par transaction, en réservant au passage : deux
    // encaissements du même versement peuvent porter sur la même facture, et
    // ils ne doivent pas se disputer le même paiement.
    const payments = await paymentsForInvoices(matched.flatMap(m => m.invoiceIds))
    const taken = new Set<number>()
    for (const m of matched) {
      const pick = choosePayments(m.amount, m.payableIds, payments, taken)
      m.paymentIds = pick.ids
      m.paymentId  = pick.ids[0] ?? null
      pick.ids.forEach(id => taken.add(id))

      // Deux encaissements du même versement rattachés à la MÊME facture : le
      // premier a pris le paiement, le second n'a plus rien. Sans ce contrôle,
      // le module tentait d'en créer un second et Odoo refusait en pleine
      // écriture, avec une pile d'exécution en pleine figure.
      if (!pick.ids.length && m.payableIds.length && (payments.get(m.payableIds[0]) || []).length) {
        m.issue = 'used'
        m.explanation = `${m.invoiceName} est déjà rattachée à un autre encaissement de ce versement — détache l'un des deux, ou rattache celui-ci à sa vraie facture`
      }

      // Règlement partiel : la facture vaut plus que l'encaissement, mais il
      // existe un paiement du montant exact. Ce n'est pas un écart — c'est une
      // facture réglée en plusieurs fois, et c'est ce paiement-là qu'on lettre.
      if (m.issue === 'gap' && pick.exact) {
        m.issue = null
        m.partial = true
        m.explanation = `${m.invoiceName} réglée en plusieurs fois — ${m.amount.toFixed(2)} € sur ${(m.invoiceTotal ?? 0).toFixed(2)} €`
      }

      // Écart d'arrondi : la TVA ne tombe pas juste, le terminal a pris un
      // centime de plus ou de moins que la facture. Ce n'est pas un écart à
      // trancher — l'OD l'absorbe, sinon la ligne bancaire resterait ouverte
      // pour un centime.
      const diff = round2(m.amount - pick.total)
      if (m.issue === 'gap' && pick.ids.length && diff !== 0 && Math.abs(diff) <= ROUNDING_TOLERANCE) {
        m.issue = null
        m.rounding = diff
        m.explanation = `${m.invoiceName} : ${m.amount.toFixed(2)} € encaissés pour ${pick.total.toFixed(2)} € — écart d'arrondi de ${diff > 0 ? '+' : ''}${diff.toFixed(2)} €, absorbé par l'OD`
      }
    }

    // Un paiement déjà lettré ailleurs rend le versement non rapprochable.
    const consumed = await explainConsumedPayments(
      matched.flatMap(m => m.paymentIds),
    )
    for (const m of matched) {
      const hit = m.paymentIds.find(id => consumed.has(id))
      if (hit && !m.issue) { m.issue = 'used'; m.paymentId = hit }
    }

    const gross      = round2(group.reduce((s, t) => s + t.rawAmount, 0))
    const commission = round2(gross - Number(line.amount))

    const blocking: string[] = []
    for (const m of matched) {
      if (m.issue === 'miss') blocking.push(m.explanation || `Référence « ${m.merchantRef} » non résolue`)
      if (m.issue === 'gap')  blocking.push(`${m.invoiceName || m.merchantRef} : encaissé ${m.amount.toFixed(2)} € pour une facture de ${(m.invoiceTotal ?? 0).toFixed(2)} €`)
      if (m.issue === 'lost') blocking.push(`${m.invoiceName} (${m.partner || '?'}) : facture encore ouverte alors qu'elle est payée`)
      if (m.issue === 'draft') blocking.push(`${m.invoiceName} (${m.partner || '?'}) : facture encore en brouillon — valide-la dans Odoo, le rapprochement suivra`)
      if (m.issue === 'used') {
        blocking.push(m.paymentId && consumed.has(m.paymentId)
          ? `${m.invoiceName} (${m.partner || '?'}) : ${consumed.get(m.paymentId)}`
          : m.explanation)
      }
    }

    // Contrôle de cohérence : le brut SumUp doit couvrir le net crédité.
    if (gross + 0.005 < Number(line.amount)) {
      blocking.push(`Incohérence : brut ${gross.toFixed(2)} € inférieur au net crédité ${Number(line.amount).toFixed(2)} €`)
    }

    const state: MatchState =
      matched.some(m => m.issue === 'miss')  ? 'miss'
      : matched.some(m => m.issue === 'draft') ? 'gap'
      : matched.some(m => m.issue === 'used')  ? 'gap'
      : matched.some(m => m.issue === 'gap')  ? 'gap'
      : matched.some(m => m.issue === 'lost') ? 'lost'
      : 'ready'

    payouts.push({
      state,
      paymentId:    pid,
      tid:          null,                 // un seul compte marchand chez SumUp
      terminal:     ref,                  // « MC7 PID1332537 », affiché tel quel
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
