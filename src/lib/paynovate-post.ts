// ============================================================
// VERVIERS DÉPANNAGE — Écritures de rapprochement Paynovate
// ============================================================
//
// Ce module PRÉPARE les écritures. Il ne les envoie pas : `buildPostingPlan`
// rend le détail exact de ce qui sera écrit, pour affichage et validation.
// L'envoi effectif est dans `postPlan`, appelé seulement après un clic.
//
// ── Le montage (validé avec Olivier le 12/08/2026) ─────────────────────
//
// Une ligne bancaire non lettrée porte aujourd'hui :
//     541 Bank                        net  D
//     265 Suspense Accounts           net      C
//
// Le rapprochement la transforme en :
//     541 Bank                        net  D
//     542 Paiements entrants en suspens net     C   → lettré contre le paiement carte
//
// Reste l'écart brut − net, la commission retenue à la source. Elle part en
// OD sur le journal Opérations Diverses :
//     236 Suppliers (Paynovate)       comm D
//     542 Paiements entrants en suspens comm    C   → lettré aussi contre le paiement
//
// Les deux crédits sur 542 (net + commission) soldent exactement le paiement
// carte, qui vaut le BRUT. Et le débit fournisseur s'accumule jusqu'à la
// facture Paynovate mensuelle, qui vient l'acquitter par lettrage.
//
// ⚠️ L'OD porte le montant TVAC, SANS ventilation TVA. La ventilation
// HTVA + TVA 21 % se fait sur la facture Paynovate, une seule fois — sinon
// la TVA serait déduite deux fois.

import { odooRpc } from '@/lib/odoo'
import type { MatchedPayout } from '@/lib/paynovate-match'

// Comptes et journaux, relevés sur la base de production.
// TODO : les basculer en app_settings quand le module sera en place.
export const ACC = {
  bank:      541,   // Bank
  suspense:  265,   // Suspense Accounts — contrepartie par défaut d'une ligne non lettrée
  outstanding: 542, // Paiements entrants en suspens
  payable:   236,   // Suppliers — compte fournisseur de Paynovate
  partner:   217,   // res.partner Paynovate
  odJournal:   9,   // Miscellaneous Operations (MISC), société Verviers Depannage
} as const

export interface OdLine { account: number; label: string; debit: number; credit: number }

export interface PostingPlan {
  payoutId:    number
  bankLineId:  number
  bankMove:    string
  net:         number
  gross:       number
  commission:  number
  invoiceIds:  number[]
  paymentIds:  number[]
  od:          { journal: number; date: string; ref: string; lines: OdLine[] } | null
  bankCounterpart: { account: number; amount: number }
  warnings:    string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Traduit un versement rapproché en écritures. Aucun appel Odoo : c'est du
 * calcul pur, affichable tel quel avant validation.
 */
export function buildPostingPlan(p: MatchedPayout): PostingPlan {
  const warnings: string[] = []

  if (p.state !== 'ready') warnings.push(`Versement en état « ${p.state} » — non rapprochable en l'état`)

  const commission = r2(p.grossAmount - p.bankAmount)
  if (commission < -0.005) warnings.push(`Commission négative (${commission.toFixed(2)} €) — le net dépasse le brut`)

  const paymentIds = p.txs.map(t => t.paymentId).filter((n): n is number => !!n)
  if (paymentIds.length !== p.txs.length) {
    warnings.push('Certaines transactions n\'ont pas de paiement enregistré dans Odoo — il faudra le créer')
  }

  const label = `Commission Paynovate — versement ${p.paymentId}${p.tid ? ` · terminal ${p.tid}` : ''} · ${p.bankDate}`

  return {
    payoutId:   p.paymentId,
    bankLineId: p.bankLineId,
    bankMove:   p.bankMoveName,
    net:        p.bankAmount,
    gross:      p.grossAmount,
    commission,
    invoiceIds: p.txs.flatMap(t => t.invoiceIds),
    paymentIds,
    od: commission > 0.005 ? {
      journal: ACC.odJournal,
      date:    p.bankDate,
      ref:     `Paynovate ${p.paymentId}`,
      lines: [
        { account: ACC.payable,     label, debit: commission, credit: 0 },
        { account: ACC.outstanding, label, debit: 0, credit: commission },
      ],
    } : null,
    bankCounterpart: { account: ACC.outstanding, amount: p.bankAmount },
    warnings,
  }
}

/** Récapitulatif d'un lot de plans — ce qu'affiche le bouton groupé. */
export function summarizePlans(plans: PostingPlan[]) {
  return {
    payouts:      plans.length,
    net:          r2(plans.reduce((s, p) => s + p.net, 0)),
    gross:        r2(plans.reduce((s, p) => s + p.gross, 0)),
    commission:   r2(plans.reduce((s, p) => s + p.commission, 0)),
    odCount:      plans.filter(p => p.od).length,
    invoices:     new Set(plans.flatMap(p => p.invoiceIds)).size,
    withWarnings: plans.filter(p => p.warnings.length).length,
  }
}

/**
 * Écrit réellement dans Odoo. Deux temps, dans cet ordre :
 *   1. l'OD de commission (créée puis validée) ;
 *   2. la contrepartie de la ligne bancaire, basculée de 265 vers 542,
 *      puis lettrage des lignes 542 contre celles des paiements carte.
 *
 * Si l'étape 2 échoue, l'OD de l'étape 1 est annulée : on ne laisse jamais
 * une OD orpheline derrière soi.
 */
export async function postPlan(plan: PostingPlan, actorNote?: string): Promise<{ odMoveId: number | null }> {
  if (plan.warnings.length) {
    throw new Error(`Rapprochement refusé : ${plan.warnings.join(' · ')}`)
  }

  let odMoveId: number | null = null

  if (plan.od) {
    const [id] = await odooRpc<number[]>('account.move', 'create', [[{
      journal_id: plan.od.journal,
      date:       plan.od.date,
      ref:        plan.od.ref + (actorNote ? ` — ${actorNote}` : ''),
      line_ids:   plan.od.lines.map(l => [0, 0, {
        account_id: l.account,
        partner_id: ACC.partner,
        name:       l.label,
        debit:      l.debit,
        credit:     l.credit,
      }]),
    }]])
    odMoveId = id
    await odooRpc('account.move', 'action_post', [[id]])
  }

  try {
    // La ligne de contrepartie de l'extrait (aujourd'hui sur 265).
    const lines = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['move_id', '=', await bankMoveIdOf(plan.bankLineId)],
      ['account_id', '=', ACC.suspense],
    ]], { fields: ['id'], limit: 2 })

    if (!lines.length) throw new Error('Ligne de contrepartie introuvable sur l\'extrait bancaire')

    await odooRpc('account.move.line', 'write', [[lines[0].id], {
      account_id: ACC.outstanding,
      partner_id: ACC.partner,
    }])

    // Lettrage : les crédits 542 (banque + OD) contre les débits 542 des paiements.
    const toReconcile = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['account_id', '=', ACC.outstanding],
      ['reconciled', '=', false],
      '|',
      ['id', '=', lines[0].id],
      ['payment_id', 'in', plan.paymentIds],
    ]], { fields: ['id', 'debit', 'credit', 'amount_residual'], limit: 100 })

    const ids = toReconcile.map(l => l.id)
    if (odMoveId) {
      const odLines = await odooRpc<any[]>('account.move.line', 'search_read', [[
        ['move_id', '=', odMoveId], ['account_id', '=', ACC.outstanding],
      ]], { fields: ['id'], limit: 2 })
      ids.push(...odLines.map(l => l.id))
    }

    // Le brut des paiements doit couvrir ce qu'on veut solder (net + commission).
    // Sinon on s'arrête là plutôt que de laisser un lettrage partiel derrière.
    const available = toReconcile.reduce((s, l) => s + Number(l.debit || 0), 0)
    if (available + 0.005 < plan.gross) {
      throw new Error(
        `Paiements insuffisants côté Odoo : ${available.toFixed(2)} € disponibles pour ${plan.gross.toFixed(2)} € encaissés`,
      )
    }

    await odooRpc('account.move.line', 'reconcile', [ids])
    return { odMoveId }
  } catch (e: any) {
    // Rollback de l'OD : on remet en brouillon puis on supprime.
    if (odMoveId) {
      try {
        await odooRpc('account.move', 'button_draft', [[odMoveId]])
        await odooRpc('account.move', 'unlink', [[odMoveId]])
      } catch { /* on remonte l'erreur d'origine, pas celle du rollback */ }
    }
    throw e
  }
}

async function bankMoveIdOf(bankLineId: number): Promise<number> {
  const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[bankLineId]], { fields: ['move_id'] })
  const id = Array.isArray(line?.move_id) ? line.move_id[0] : line?.move_id
  if (!id) throw new Error(`Ligne bancaire ${bankLineId} sans écriture associée`)
  return Number(id)
}
