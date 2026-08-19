// ============================================================
// VERVIERS DÉPANNAGE — Écritures de rapprochement SumUp
// ============================================================
//
// Ce module PRÉPARE les écritures. L'envoi effectif reste `postPlan`, partagé
// avec Paynovate : la mécanique est rigoureusement la même, seul le tiers et
// la caisse d'encaissement changent.
//
// ── Le montage (validé par Olivier le 19/08/2026) ──────────────────────
//
// Une ligne bancaire non lettrée porte :
//     541 Bank                          net  D
//     265 Suspense Accounts             net      C
//
// Le rapprochement la transforme en :
//     541 Bank                          net  D
//     542 Paiements entrants en suspens net      C   → lettré contre le paiement
//
// Reste l'écart brut − net, la commission retenue à la source, en OD :
//     236 Suppliers (SumUp)             comm D
//     542 Paiements entrants en suspens comm     C   → lettré aussi
//
// Les deux crédits sur 542 soldent le paiement carte, qui vaut le BRUT.
// Le débit s'accumule sur le compte fournisseur SumUp jusqu'à la facture de
// frais, qui vient l'acquitter par lettrage — même logique que Paynovate.
//
// ⚠️ L'OD porte le montant TVAC sans ventilation TVA : la ventilation se fait
// sur la facture SumUp, une seule fois.

import { ACC, type MissingPayment, type PostingPlan } from '@/lib/paynovate-post'
import { unallocatedOdLines, roundingOdLines } from '@/lib/reconcile-odoo'
import type { MatchedPayout } from '@/lib/paynovate-match'

/** res.partner « SumUp Ltd - German Branch » — celui que porte la seule facture SumUp encodée. */
export const SUMUP_PARTNER = 1221

/**
 * Où enregistrer un paiement SumUp manquant.
 *
 * Un seul compte marchand chez SumUp, donc pas de choix de site à faire : les
 * encaissements SumUp de l'app atterrissent tous sur « Encaissement Chauffeur »,
 * méthode « Sumup ». On crée le paiement manquant au même endroit, sinon il ne
 * ressemblerait pas aux 200 autres et fausserait le journal de caisse.
 */
export const SUMUP_CASH = { site: 'Encaissement Chauffeur', journal: 15, methodLine: 15 } as const

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Traduit un versement SumUp rapproché en écritures. Aucun appel Odoo : c'est
 * du calcul pur, affichable tel quel avant validation.
 */
export function buildSumupPostingPlan(p: MatchedPayout): PostingPlan {
  const warnings: string[] = []

  // « lost » est rapprochable : il manque juste le paiement, qu'on va créer.
  if (p.state !== 'ready' && p.state !== 'lost') {
    warnings.push(`Versement en état « ${p.state} » — non rapprochable en l'état`)
  }

  const commission = r2(p.grossAmount - p.bankAmount)
  if (commission < -0.005) warnings.push(`Commission négative (${commission.toFixed(2)} €) — le net dépasse le brut`)

  // Transactions dont la facture est restée ouverte : on créera le paiement
  // SumUp manquant sur la caisse d'encaissement.
  const paymentsToCreate: MissingPayment[] = []
  for (const t of p.txs) {
    // Une ligne passée en OD n'a pas de facture à solder : son débit 542 vient
    // de l'OD elle-même. La faire passer ici produisait un avertissement
    // bloquant (« paiement à créer sur plusieurs factures »).
    if (t.unallocated) continue
    if (t.issue === 'gap' || t.issue === 'miss' || t.issue === 'draft') continue
    // Couverte = CHAQUE facture a son paiement. Se contenter du premier laissait
    // passer une transaction à deux factures dont une seule était payée : le
    // lettrage tombait à court, sans que rien ne l'ait annoncé.
    if (t.payableIds.length > 0 && t.paymentIds.length === t.payableIds.length) continue
    // Facture déjà soldée : Odoo refuse tout net (« il ne reste rien à payer »).
    // On ne tente donc jamais. Si elle est soldée mais qu'aucun paiement n'est
    // disponible, c'est un cas à trancher — le contrôle de couverture le dira.
    const paid = t.paymentState === 'paid' || t.paymentState === 'in_payment'
    if (paid) continue
    if (t.payableIds.length !== 1) {
      warnings.push(`${t.merchantRef} : paiement à créer sur plusieurs factures — à faire à la main`)
      continue
    }
    paymentsToCreate.push({
      invoiceId:   t.payableIds[0],
      invoiceName: t.invoiceName || t.merchantRef,
      amount:      t.amount,
      date:        (t.at || p.bankDate).slice(0, 10),
      journal:     SUMUP_CASH.journal,
      methodLine:  SUMUP_CASH.methodLine,
      site:        SUMUP_CASH.site,
    })
  }

  // Tous les paiements de toutes les factures : une transaction peut en couvrir
  // plusieurs, et il faut les lettrer ensemble pour solder le brut.
  const paymentIds = [...new Set(p.txs.flatMap(t => t.paymentIds))]

  const ref   = p.terminal || `PID${p.paymentId}`
  const label = `Commission SumUp — versement ${ref} · ${p.bankDate}`

  // Lignes dont on a décidé qu'elles partaient en OD : elles produisent le
  // débit 542 manquant, en face du compte d'attente.
  const odUnallocated = unallocatedOdLines(p.txs, `SumUp ${ref}`)
  const unallocatedTotal = r2(odUnallocated.reduce((s, l) => s + l.debit, 0))

  // Écarts d'arrondi : quelques centimes qui doivent exister quelque part,
  // sinon la ligne bancaire reste ouverte pour un centime.
  const odRounding = roundingOdLines(p.txs, `SumUp ${ref}`)
  const roundingTotal = r2(p.txs.reduce((s, t) => s + (t.rounding || 0), 0))

  // Une transaction est couverte si elle est passée en OD, si toutes ses
  // factures ont leur paiement, ou si les manquants seront créés. On compte des
  // TRANSACTIONS : compter les paiements faussait le total dès qu'une seule
  // transaction en portait deux.
  const uncovered = p.txs.filter(t => {
    if (t.unallocated) return false
    if (t.payableIds.length > 0 && t.paymentIds.length === t.payableIds.length) return false
    return !paymentsToCreate.some(m => t.payableIds.includes(m.invoiceId))
  })
  if (uncovered.length) {
    warnings.push(`${uncovered.length} transaction(s) sans paiement enregistré ni créable — à traiter à la main`)
  }

  return {
    payoutId:   p.paymentId,
    partnerId:  SUMUP_PARTNER,
    bankLineId: p.bankLineId,
    bankMove:   p.bankMoveName,
    net:        p.bankAmount,
    gross:      p.grossAmount,
    commission,
    invoiceIds: p.txs.flatMap(t => t.invoiceIds),
    paymentIds,
    paymentsToCreate,
    unallocatedTotal,
    roundingTotal,
    od: (commission > 0.005 || odUnallocated.length || odRounding.length) ? {
      journal: ACC.odJournal,
      date:    p.bankDate,
      ref:     `SumUp ${ref}`,
      lines: [
        ...(commission > 0.005 ? [
          { account: ACC.payable,     label, debit: commission, credit: 0 },
          { account: ACC.outstanding, label, debit: 0, credit: commission },
        ] : []),
        ...odUnallocated,
        ...odRounding,
      ],
    } : null,
    bankCounterpart: { account: ACC.outstanding, amount: p.bankAmount },
    warnings,
  }
}
