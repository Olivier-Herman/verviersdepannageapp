// ============================================================
// VERVIERS DÉPANNAGE — Écritures de rapprochement assureurs
// ============================================================
//
// Beaucoup plus simple que Paynovate, parce que l'argent n'a pas été encaissé
// au préalable : la facture est ouverte, l'assureur la paie, on lettre.
//
// Une ligne bancaire non lettrée porte :
//     541 Bank                    montant D
//     265 Suspense Accounts               montant C
//
// Le rapprochement la transforme en :
//     541 Bank                    montant D
//     206 Customers (l'assureur)          montant C   → lettré contre les factures
//
// Pas de compte d'attente, pas d'OD, pas de commission : l'assureur ne prélève
// rien. Les factures sont adressées directement à l'assureur (Ethias #16 via
// son adresse de facturation #17, AWP #45), donc un seul tiers par virement.
//
// ⚠️ Comme pour Paynovate : TOUTES les vérifications avant la première
// écriture. Basculer la contrepartie puis échouer laisserait une ligne qui
// paraît lettrée alors que rien ne l'est, et qui disparaîtrait de la file.

import { odooRpc } from '@/lib/odoo'
import { PAYERS, type MatchedAdvicePayment } from '@/lib/advice-match'

/** Compte de créances clients — le même pour tous nos assureurs. */
export const RECEIVABLE = 206
/** Contrepartie par défaut d'une ligne bancaire non lettrée. */
export const SUSPENSE = 265

export interface AdvicePostingPlan {
  bankLineId:  number
  bankMove:    string
  bankDate:    string
  amount:      number
  payerLabel:  string
  partnerId:   number
  invoiceIds:  number[]
  invoiceNames: string[]
  warnings:    string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Traduit un paiement assureur rapproché en écriture. Calcul pur, affichable
 * avant validation.
 */
export function buildAdvicePlan(item: MatchedAdvicePayment): AdvicePostingPlan {
  const warnings: string[] = []
  if (item.state !== 'ready') warnings.push(`Paiement en état « ${item.state} » — non rapprochable en l'état`)
  if (!item.bank)             warnings.push('Aucun virement associé')

  const payer = PAYERS.find(p => p.key === item.payer)
  if (!payer) warnings.push(`Payeur « ${item.payer} » non répertorié`)

  const withInvoice = item.invoices.filter(i => i.invoiceId)
  if (withInvoice.length !== item.invoices.length) {
    warnings.push('Certaines lignes de l\'avis n\'ont pas de facture retrouvée')
  }

  return {
    bankLineId:  item.bank?.lineId ?? 0,
    bankMove:    item.bank?.moveName ?? '',
    bankDate:    item.bank?.date ?? '',
    amount:      item.bank?.amount ?? 0,
    payerLabel:  item.payerLabel,
    partnerId:   payer?.partnerId ?? 0,
    invoiceIds:  withInvoice.map(i => i.invoiceId as number),
    invoiceNames: withInvoice.map(i => i.invoiceName as string),
    warnings,
  }
}

/** Récapitulatif d'un lot — ce qu'affiche la validation groupée. */
export function summarizeAdvicePlans(plans: AdvicePostingPlan[]) {
  return {
    payments: plans.length,
    amount:   r2(plans.reduce((s, p) => s + p.amount, 0)),
    invoices: new Set(plans.flatMap(p => p.invoiceIds)).size,
    withWarnings: plans.filter(p => p.warnings.length).length,
  }
}

/**
 * Écrit dans Odoo : bascule la contrepartie de l'extrait vers le compte
 * clients, puis lettre contre les lignes de créance des factures.
 */
export async function postAdvicePlan(plan: AdvicePostingPlan): Promise<{ reconciled: number }> {
  if (plan.warnings.length) {
    throw new Error(`Rapprochement refusé : ${plan.warnings.join(' · ')}`)
  }

  // ── Vérifications AVANT toute écriture ────────────────────
  const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[plan.bankLineId]], { fields: ['move_id'] })
  const bankMoveId = Array.isArray(line?.move_id) ? Number(line.move_id[0]) : Number(line?.move_id)
  if (!bankMoveId) throw new Error(`Ligne bancaire ${plan.bankLineId} sans écriture associée`)

  const suspense = await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['move_id', '=', bankMoveId],
    ['account_id', '=', SUSPENSE],
  ]], { fields: ['id', 'partner_id'], limit: 2 })
  if (!suspense.length) {
    throw new Error('Ce virement a déjà été touché : sa contrepartie n\'est plus en compte d\'attente')
  }
  const suspenseLineId  = suspense[0].id
  const originalPartner = Array.isArray(suspense[0].partner_id) ? suspense[0].partner_id[0] : (suspense[0].partner_id || false)

  // Les créances encore ouvertes sur ces factures.
  const receivables = await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['move_id', 'in', plan.invoiceIds],
    ['account_id', '=', RECEIVABLE],
    ['reconciled', '=', false],
  ]], { fields: ['id', 'debit', 'credit', 'amount_residual', 'move_id'], limit: 300 })

  if (!receivables.length) {
    throw new Error('Aucune créance ouverte sur ces factures — elles ont déjà été soldées')
  }

  // Le solde dû doit couvrir le virement, sinon on lettrerait à moitié.
  const openSum = r2(receivables.reduce((s, l) => s + Number(l.amount_residual || 0), 0))
  if (openSum + 0.02 < plan.amount) {
    const soldees = plan.invoiceIds.length - receivables.length
    throw new Error(
      `Créances insuffisantes : ${openSum.toFixed(2)} € encore dus pour un virement de ${plan.amount.toFixed(2)} €`
      + (soldees > 0 ? ` — ${soldees} facture(s) déjà soldée(s) par ailleurs` : '')
      + '. À traiter à la main.',
    )
  }

  // ── Écritures ─────────────────────────────────────────────
  let moved = false
  try {
    await odooRpc('account.move.line', 'write', [[suspenseLineId], {
      account_id: RECEIVABLE,
      partner_id: plan.partnerId,
    }])
    moved = true

    await odooRpc('account.move.line', 'reconcile', [[suspenseLineId, ...receivables.map(l => l.id)]])
    return { reconciled: receivables.length }
  } catch (e: any) {
    if (moved) {
      try {
        await odooRpc('account.move.line', 'write', [[suspenseLineId], {
          account_id: SUSPENSE,
          partner_id: originalPartner,
        }])
      } catch { /* on remonte l'erreur d'origine */ }
    }
    throw e
  }
}
