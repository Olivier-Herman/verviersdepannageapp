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

/**
 * Terminal → caisse sur laquelle enregistrer un paiement Bancontact manquant.
 * Le TID identifie le site : c'est la seule information fiable, les deux
 * terminaux versant sur le même compte bancaire.
 */
export const TERMINALS: Record<string, { site: string; journal: number; methodLine: number }> = {
  '38904065': { site: 'Fourrière', journal: 14, methodLine: 12 },  // Bancontact (Fourrière Caisse)
  '38912308': { site: 'Dépannage', journal: 13, methodLine: 11 },  // Bancontact (Dépannage Caisse)
}

export interface OdLine { account: number; label: string; debit: number; credit: number }

/** Un paiement à créer parce que la facture est restée ouverte alors qu'elle est payée. */
export interface MissingPayment {
  invoiceId:   number
  invoiceName: string
  amount:      number      // le BRUT encaissé au terminal
  date:        string
  journal:     number
  methodLine:  number
  site:        string
}

export interface PostingPlan {
  payoutId:    number
  bankLineId:  number
  bankMove:    string
  net:         number
  gross:       number
  commission:  number
  invoiceIds:  number[]
  paymentIds:  number[]
  paymentsToCreate: MissingPayment[]
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

  // « lost » est rapprochable : il manque juste le paiement, qu'on va créer.
  if (p.state !== 'ready' && p.state !== 'lost') {
    warnings.push(`Versement en état « ${p.state} » — non rapprochable en l'état`)
  }

  const commission = r2(p.grossAmount - p.bankAmount)
  if (commission < -0.005) warnings.push(`Commission négative (${commission.toFixed(2)} €) — le net dépasse le brut`)

  const terminal = p.tid ? TERMINALS[p.tid] : undefined

  // Transactions dont la facture est restée ouverte : on créera le paiement
  // Bancontact manquant sur la caisse du terminal qui a encaissé.
  const paymentsToCreate: MissingPayment[] = []
  for (const t of p.txs) {
    if (t.paymentId || t.issue === 'gap' || t.issue === 'miss') continue
    const paid = t.paymentState === 'paid' || t.paymentState === 'in_payment'
    if (paid) continue
    if (t.invoiceIds.length !== 1) {
      warnings.push(`${t.merchantRef} : paiement à créer sur plusieurs factures — à faire à la main`)
      continue
    }
    if (!terminal) {
      warnings.push(`Terminal ${p.tid || 'inconnu'} non répertorié — impossible de savoir sur quelle caisse enregistrer le paiement`)
      continue
    }
    paymentsToCreate.push({
      invoiceId:   t.invoiceIds[0],
      invoiceName: t.invoiceName || t.merchantRef,
      amount:      t.amount,
      date:        (t.at || p.bankDate).slice(0, 10),
      journal:     terminal.journal,
      methodLine:  terminal.methodLine,
      site:        terminal.site,
    })
  }

  const paymentIds = p.txs.map(t => t.paymentId).filter((n): n is number => !!n)
  const covered = paymentIds.length + paymentsToCreate.length
  if (covered !== p.txs.length) {
    warnings.push('Certaines transactions n\'ont ni paiement enregistré ni paiement créable — à traiter à la main')
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
    paymentsToCreate,
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

  // ── Vérifications AVANT toute écriture ────────────────────
  // Ordre capital : modifier l'extrait puis échouer laisse une ligne qui
  // paraît lettrée alors que rien ne l'est. On contrôle donc d'abord.
  const bankMoveId = await bankMoveIdOf(plan.bankLineId)

  const suspenseLines = await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['move_id', '=', bankMoveId],
    ['account_id', '=', ACC.suspense],
  ]], { fields: ['id', 'partner_id'], limit: 2 })
  if (!suspenseLines.length) {
    throw new Error('Cet extrait a déjà été touché : sa contrepartie n\'est plus en compte d\'attente')
  }
  // Valeur d'origine, à restituer telle quelle en cas de rollback.
  const originalPartner = Array.isArray(suspenseLines[0].partner_id)
    ? suspenseLines[0].partner_id[0]
    : (suspenseLines[0].partner_id || false)

  const available = await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['account_id', '=', ACC.outstanding],
    ['reconciled', '=', false],
    ['payment_id', 'in', plan.paymentIds],
  ]], { fields: ['id', 'debit', 'payment_id'], limit: 200 })

  const toCreateSum  = r2(plan.paymentsToCreate.reduce((s, m) => s + m.amount, 0))
  const availableSum = r2(available.reduce((s, l) => s + Number(l.debit || 0), 0) + toCreateSum)
  if (availableSum + 0.005 < plan.gross) {
    const used = plan.paymentIds.filter(id => !available.some(l => (Array.isArray(l.payment_id) ? l.payment_id[0] : l.payment_id) === id))
    throw new Error(
      `Paiements déjà lettrés ailleurs : ${availableSum.toFixed(2)} € disponibles pour ${plan.gross.toFixed(2)} € encaissés`
      + (used.length ? ` — ${used.length} paiement(s) déjà utilisé(s) sur une autre ligne bancaire` : '')
      + '. À traiter à la main.',
    )
  }

  // ── Écritures ─────────────────────────────────────────────
  // 0. Les paiements manquants (encaissements perdus) : le client a payé au
  //    terminal mais la facture est restée ouverte dans Odoo. On enregistre le
  //    paiement Bancontact sur la caisse du terminal, ce qui solde la facture
  //    et crée la ligne 542 que le lettrage suivant consommera.
  const createdPaymentIds: number[] = []
  for (const m of plan.paymentsToCreate) {
    const id = await registerPayment(m)
    createdPaymentIds.push(id)
  }
  if (createdPaymentIds.length) {
    plan.paymentIds.push(...createdPaymentIds)
    // Les lignes 542 fraîchement créées doivent entrer dans le lettrage.
    const fresh = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['account_id', '=', ACC.outstanding],
      ['reconciled', '=', false],
      ['payment_id', 'in', createdPaymentIds],
    ]], { fields: ['id', 'debit', 'payment_id'], limit: 50 })
    available.push(...fresh)
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

  const suspenseLineId = suspenseLines[0].id
  let bankLineMoved = false

  try {
    await odooRpc('account.move.line', 'write', [[suspenseLineId], {
      account_id: ACC.outstanding,
      partner_id: ACC.partner,
    }])
    bankLineMoved = true

    // Lettrage : les crédits 542 (banque + OD) contre les débits 542 des paiements.
    const ids = [suspenseLineId, ...available.map(l => l.id)]
    if (odMoveId) {
      const odLines = await odooRpc<any[]>('account.move.line', 'search_read', [[
        ['move_id', '=', odMoveId], ['account_id', '=', ACC.outstanding],
      ]], { fields: ['id'], limit: 2 })
      ids.push(...odLines.map(l => l.id))
    }

    await odooRpc('account.move.line', 'reconcile', [ids])
    return { odMoveId }
  } catch (e: any) {
    // Rollback complet : on ne laisse ni OD orpheline, ni extrait à moitié
    // basculé — un extrait dont la contrepartie a quitté le compte d'attente
    // passe pour lettré alors que rien ne l'est, et disparaît de la file.
    if (bankLineMoved) {
      try {
        await odooRpc('account.move.line', 'write', [[suspenseLineId], {
          account_id: ACC.suspense,
          partner_id: originalPartner,
        }])
      } catch { /* on remonte l'erreur d'origine */ }
    }
    if (odMoveId) {
      try {
        await odooRpc('account.move', 'button_draft', [[odMoveId]])
        await odooRpc('account.move', 'unlink', [[odMoveId]])
      } catch { /* idem */ }
    }
    // Les paiements créés à l'étape 0 doivent partir aussi, sinon la facture
    // reste soldée par un paiement qui ne correspond à aucun lettrage.
    for (const pid of createdPaymentIds) {
      try {
        await odooRpc('account.payment', 'action_draft', [[pid]])
        await odooRpc('account.payment', 'unlink', [[pid]])
      } catch { /* idem */ }
    }
    throw e
  }
}

/**
 * Enregistre le paiement Bancontact manquant sur une facture restée ouverte.
 *
 * On passe par l'assistant `account.payment.register` plutôt que de créer un
 * `account.payment` à la main : c'est lui qui choisit les bons comptes, pose
 * le partenaire, valide l'écriture et lettre le paiement sur la facture. Le
 * faire soi-même reviendrait à réimplémenter — mal — ce que fait Odoo.
 *
 * @returns l'id du paiement créé.
 */
async function registerPayment(m: MissingPayment): Promise<number> {
  const ctx = { active_model: 'account.move', active_ids: [m.invoiceId], active_id: m.invoiceId }

  const wizardId = await odooRpc<number>('account.payment.register', 'create', [{
    payment_date:           m.date,
    amount:                 m.amount,
    journal_id:             m.journal,
    payment_method_line_id: m.methodLine,
    communication:          m.invoiceName,
  }], { context: ctx })

  await odooRpc('account.payment.register', 'action_create_payments', [[wizardId]], { context: ctx })

  // L'assistant ne renvoie pas l'id du paiement : on le retrouve par la facture.
  const payments = await odooRpc<any[]>('account.payment', 'search_read', [[
    ['reconciled_invoice_ids', 'in', [m.invoiceId]],
  ]], { fields: ['id'], order: 'id desc', limit: 1 })

  if (!payments.length) {
    throw new Error(`Paiement créé pour ${m.invoiceName} mais introuvable ensuite — à vérifier dans Odoo`)
  }
  return payments[0].id
}

async function bankMoveIdOf(bankLineId: number): Promise<number> {
  const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[bankLineId]], { fields: ['move_id'] })
  const id = Array.isArray(line?.move_id) ? line.move_id[0] : line?.move_id
  if (!id) throw new Error(`Ligne bancaire ${bankLineId} sans écriture associée`)
  return Number(id)
}
