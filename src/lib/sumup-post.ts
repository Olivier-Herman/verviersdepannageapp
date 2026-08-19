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
    if (t.paymentId || t.issue === 'gap' || t.issue === 'miss' || t.issue === 'draft') continue
    const paid = t.paymentState === 'paid' || t.paymentState === 'in_payment'
    if (paid) continue
    if (t.invoiceIds.length !== 1) {
      warnings.push(`${t.merchantRef} : paiement à créer sur plusieurs factures — à faire à la main`)
      continue
    }
    paymentsToCreate.push({
      invoiceId:   t.invoiceIds[0],
      invoiceName: t.invoiceName || t.merchantRef,
      amount:      t.amount,
      date:        (t.at || p.bankDate).slice(0, 10),
      journal:     SUMUP_CASH.journal,
      methodLine:  SUMUP_CASH.methodLine,
      site:        SUMUP_CASH.site,
    })
  }

  const paymentIds = p.txs.map(t => t.paymentId).filter((n): n is number => !!n)
  if (paymentIds.length + paymentsToCreate.length !== p.txs.length) {
    warnings.push('Certaines transactions n\'ont ni paiement enregistré ni paiement créable — à traiter à la main')
  }

  const ref   = p.terminal || `PID${p.paymentId}`
  const label = `Commission SumUp — versement ${ref} · ${p.bankDate}`

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
    od: commission > 0.005 ? {
      journal: ACC.odJournal,
      date:    p.bankDate,
      ref:     `SumUp ${ref}`,
      lines: [
        { account: ACC.payable,     label, debit: commission, credit: 0 },
        { account: ACC.outstanding, label, debit: 0, credit: commission },
      ],
    } : null,
    bankCounterpart: { account: ACC.outstanding, amount: p.bankAmount },
    warnings,
  }
}
