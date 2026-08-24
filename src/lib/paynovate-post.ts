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

import { odooRpc, postChatterMessage } from '@/lib/odoo'
import { unallocatedOdLines, roundingOdLines, humanOdooError, splitCounterpart, type CounterpartSplit } from '@/lib/reconcile-odoo'
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
  /**
   * Le tiers porté par l'OD et par la ligne bancaire basculée. Paynovate et
   * SumUp partagent la même mécanique mais pas le même fournisseur — c'est le
   * seul endroit où le prestataire transparaît dans `postPlan`.
   */
  partnerId:   number
  bankLineId:  number
  bankMove:    string
  net:         number
  gross:       number
  commission:  number
  invoiceIds:  number[]
  paymentIds:  number[]
  paymentsToCreate: MissingPayment[]
  /** Somme signée des écarts d'arrondi absorbés par l'OD. */
  roundingTotal: number
  /**
   * Le détail du versement, transaction par transaction — pour l'écrire dans
   * Odoo. Sans lui, l'extrait n'affiche qu'une ligne « Paiements entrants en
   * suspens » face à N rapprochements : le détail n'existe que dans le
   * lettrage, invisible tant qu'on ne l'ouvre pas. Olivier 2026-08-24.
   */
  detail: { at: string | null; ref: string; card: string; amount: number; invoice: string | null; partner: string | null; note: string | null }[]
  /**
   * La contrepartie du virement, éclatée en une ligne par paiement carte —
   * c'est ce qui rend le détail visible sur l'extrait Odoo.
   */
  splits: CounterpartSplit[]
  /**
   * Montant des lignes passées en OD faute de facture identifiable. Il est
   * couvert par l'OD elle-même (débit 542) et non par un paiement carte — le
   * contrôle de disponibilité avant écriture doit donc le compter.
   */
  unallocatedTotal: number
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
    if (!terminal) {
      warnings.push(`Terminal ${p.tid || 'inconnu'} non répertorié — impossible de savoir sur quelle caisse enregistrer le paiement`)
      continue
    }
    paymentsToCreate.push({
      invoiceId:   t.payableIds[0],
      invoiceName: t.invoiceName || t.merchantRef,
      amount:      t.amount,
      date:        (t.at || p.bankDate).slice(0, 10),
      journal:     terminal.journal,
      methodLine:  terminal.methodLine,
      site:        terminal.site,
    })
  }

  // Tous les paiements de toutes les factures : une transaction peut en couvrir
  // plusieurs, et il faut les lettrer ensemble pour solder le brut.
  const paymentIds = [...new Set(p.txs.flatMap(t => t.paymentIds))]
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

  const label = `Commission Paynovate — versement ${p.paymentId}${p.tid ? ` · terminal ${p.tid}` : ''} · ${p.bankDate}`

  const detail = p.txs.map(t => ({
    at:      t.at,
    ref:     t.merchantRef,
    card:    t.cardBrand,
    amount:  t.amount,
    invoice: t.invoiceName,
    partner: t.partner,
    note:    t.unallocated ? `non affecté — ${t.unallocated.reason}`
           : t.rounding    ? `arrondi ${t.rounding > 0 ? '+' : ''}${t.rounding.toFixed(2)} €`
           : t.partial     ? 'règlement partiel' : null,
  }))

  // Lignes dont on a décidé qu'elles partaient en OD : elles produisent le
  // débit 542 manquant, en face du compte d'attente.
  const odUnallocated = unallocatedOdLines(p.txs, `Paynovate ${p.paymentId}`)
  const unallocatedTotal = r2(odUnallocated.reduce((s, l) => s + l.debit, 0))

  // Écarts d'arrondi : quelques centimes qui doivent exister quelque part,
  // sinon la ligne bancaire reste ouverte pour un centime.
  const odRounding = roundingOdLines(p.txs, `Paynovate ${p.paymentId}`)
  const roundingTotal = r2(p.txs.reduce((s, t) => s + (t.rounding || 0), 0))

  return {
    payoutId:   p.paymentId,
    partnerId:  ACC.partner,
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
    detail,
    splits: splitCounterpart(p.txs, p.bankAmount),
    od: (commission > 0.005 || odUnallocated.length || odRounding.length) ? {
      journal: ACC.odJournal,
      date:    p.bankDate,
      ref:     `Paynovate ${p.paymentId}`,
      lines: [
        // Une paire par transaction : la commission suit sa facture, et le
        // lettrage de chaque ligne d'extrait tombe juste au centime.
        ...splitCounterpart(p.txs, p.bankAmount).flatMap(sp => sp.commission > 0.005 ? [
          { account: ACC.payable,     label: `${label} · ${sp.label}`, debit: sp.commission, credit: 0 },
          { account: ACC.outstanding, label: `${label} · ${sp.label}`, debit: 0, credit: sp.commission },
        ] : []),
        ...odUnallocated,
        ...odRounding,
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
    unallocated:  r2(plans.reduce((s, p) => s + (p.unallocatedTotal || 0), 0)),
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
  // Les lignes passées en OD n'ont pas de paiement carte : c'est l'OD qui
  // fournira leur débit 542. Sans les compter ici, le contrôle refuserait à
  // tort un versement qu'on vient précisément de débloquer.
  // Ce que le lettrage aura sous la main : les débits 542 des paiements
  // existants, ceux des paiements qu'on va créer, ceux que l'OD apporte pour
  // les lignes non affectées, et l'écart d'arrondi — signé, car il peut aussi
  // retirer un centime.
  const availableSum = r2(
    available.reduce((s, l) => s + Number(l.debit || 0), 0)
    + toCreateSum + (plan.unallocatedTotal || 0) + (plan.roundingTotal || 0),
  )
  // Garde-fou de l'éclatement : sans ces deux invariants, l'extrait ne boucle
  // pas et Odoo refuse l'écriture au milieu du lot.
  if (plan.splits.length) {
    const sumNet = r2(plan.splits.reduce((s, x) => s + x.net, 0))
    if (Math.abs(sumNet - plan.net) > 0.005) {
      throw new Error(`Éclatement incohérent : ${sumNet.toFixed(2)} € répartis pour ${plan.net.toFixed(2)} € crédités`)
    }
    const bad = plan.splits.find(x => Math.abs(x.net + x.commission - x.amount) > 0.005)
    if (bad) throw new Error(`Éclatement incohérent sur « ${bad.label} » : ${bad.net.toFixed(2)} + ${bad.commission.toFixed(2)} ≠ ${bad.amount.toFixed(2)}`)
  }

  if (availableSum + 0.005 < plan.gross) {
    const used = plan.paymentIds.filter(id => !available.some(l => (Array.isArray(l.payment_id) ? l.payment_id[0] : l.payment_id) === id))
    const short = r2(plan.gross - availableSum)
    throw new Error(
      `Il manque ${short.toFixed(2)} € au lettrage : ${availableSum.toFixed(2)} € disponibles pour ${plan.gross.toFixed(2)} € encaissés`
      + (used.length
          ? ` — ${used.length} paiement(s) déjà lettré(s) sur une autre ligne bancaire`
          : ' — aucun paiement n\'est lettré ailleurs, il en manque simplement un')
      + '. À traiter à la main.',
    )
  }

  // ── Écritures ─────────────────────────────────────────────
  // 0. Les paiements manquants (encaissements perdus) : le client a payé au
  //    terminal mais la facture est restée ouverte dans Odoo. On enregistre le
  //    paiement Bancontact sur la caisse du terminal, ce qui solde la facture
  //    et crée la ligne 542 que le lettrage suivant consommera.
  const createdPaymentIds: number[] = []
  try {
    for (const m of plan.paymentsToCreate) {
      const id = await registerPayment(m)
      createdPaymentIds.push(id)
    }
  } catch (e: any) {
    // Un échec au milieu du lot laissait les paiements déjà créés derrière lui :
    // des factures soldées par un paiement qui ne serait jamais lettré.
    for (const pid of createdPaymentIds.reverse()) {
      try {
        await odooRpc('account.payment', 'action_draft', [[pid]])
        await odooRpc('account.payment', 'unlink', [[pid]])
      } catch { /* on remonte l'erreur d'origine */ }
    }
    throw new Error(`Paiement impossible à enregistrer : ${humanOdooError(e)}`)
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
        partner_id: plan.partnerId,
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
    // La contrepartie unique devient UNE LIGNE PAR PAIEMENT CARTE, chacune
    // portant sa facture : c'est ce qu'on voit en ouvrant l'extrait, sans avoir
    // à déplier le lettrage.
    // La contrepartie unique devient UNE LIGNE PAR PAIEMENT CARTE, chacune
    // nommée avec sa facture : c'est ce qu'on lit en ouvrant l'extrait, sans
    // avoir à déplier le lettrage.
    //
    // ⚠️ Le chemin d'écriture n'est pas indifférent — trois façons ont été
    // refusées par Odoo 19 avant celle-ci (éprouvées sur vdtest1308) :
    //   · `account.move.write` sur une pièce comptabilisée → line_ids en
    //     lecture seule ;
    //   · `account.bank.statement.line.write({line_ids})` → chaque commande
    //     passe par un write séparé et le contrôle d'équilibre tombe entre
    //     les deux, « L'écriture n'est pas équilibrée » ;
    //   · `[5,0,0]` pour tout reconstruire → suppression interdite sur une
    //     écriture validée.
    // Seul le passage en brouillon, une écriture unique sur la PIÈCE, puis la
    // revalidation, fait le compte.
    const names = [...new Set(plan.detail.map(d => d.invoice).filter(Boolean))] as string[]
    const splits: CounterpartSplit[] = plan.splits.length ? plan.splits : [{
      partnerId: null, paymentId: null,
      net: plan.net, commission: 0, amount: plan.net, invoice: null,
      label: `Versement ${plan.od?.ref || plan.payoutId}`
           + (names.length ? ` : ${names.slice(0, 6).join(', ')}` : ''),
    }]

    await odooRpc('account.move', 'button_draft', [[bankMoveId]])
    try {
      await odooRpc('account.move', 'write', [[bankMoveId], {
        line_ids: [
          // La première réutilise la ligne existante, les suivantes sont créées.
          // Le tiers de CHAQUE ligne est le client de la facture, pas le
          // prestataire : c'est lui qu'on veut lire en face du montant.
          [1, suspenseLineId, {
            account_id: ACC.outstanding, partner_id: splits[0].partnerId || plan.partnerId,
            name: splits[0].label, debit: 0, credit: splits[0].net, amount_currency: -splits[0].net,
          }],
          ...splits.slice(1).map(sp => [0, 0, {
            account_id: ACC.outstanding, partner_id: sp.partnerId || plan.partnerId,
            name: sp.label, debit: 0, credit: sp.net, amount_currency: -sp.net,
          }]),
        ],
      }])
    } finally {
      // Quoi qu'il arrive, l'extrait ne reste pas en brouillon.
      await odooRpc('account.move', 'action_post', [[bankMoveId]])
    }
    bankLineMoved = true

    // Lettrage UN À UN, et non en bloc : c'est ce qui permet à Odoo d'afficher,
    // en face de chaque ligne d'extrait, LE paiement qu'elle solde. Lettré
    // globalement, il crée des rapprochements croisés et n'affiche plus rien.
    const bankParts = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['move_id', '=', bankMoveId], ['account_id', '=', ACC.outstanding],
    ]], { fields: ['id', 'credit'], order: 'id', limit: 200 })
    const odLines = odMoveId
      ? await odooRpc<any[]>('account.move.line', 'search_read', [[
          ['move_id', '=', odMoveId], ['account_id', '=', ACC.outstanding],
        ]], { fields: ['id', 'debit', 'credit'], order: 'id', limit: 200 })
      : []

    const payLineOf = new Map<number, number>()
    for (const l of available) {
      const pid = Array.isArray(l.payment_id) ? Number(l.payment_id[0]) : Number(l.payment_id)
      if (pid && !payLineOf.has(pid)) payLineOf.set(pid, l.id)
    }

    // Une commission par transaction, dans le même ordre que les contreparties.
    const commLines = odLines.filter(l => Number(l.credit) > 0).map(l => l.id)
    const restOd    = odLines.filter(l => !commLines.includes(l.id)).map(l => l.id)

    const grouped = new Set<number>()
    for (let i = 0; i < bankParts.length && i < splits.length; i++) {
      const group = [bankParts[i].id]
      const payLine = splits[i].paymentId ? payLineOf.get(splits[i].paymentId!) : undefined
      if (payLine) group.push(payLine)
      if (commLines[i]) group.push(commLines[i])
      if (group.length < 2) continue
      group.forEach(id => grouped.add(id))
      await odooRpc('account.move.line', 'reconcile', [group])
    }

    // Le reliquat — paiements créés à la volée, lignes non affectées, arrondi —
    // part dans un lettrage groupé : il n'a pas de correspondance un à un.
    const rest = [
      ...bankParts.map(l => l.id), ...available.map(l => l.id),
      ...commLines, ...restOd,
    ].filter(id => !grouped.has(id))
    if (rest.length > 1) await odooRpc('account.move.line', 'reconcile', [rest])

    // Le détail complet dans le fil de l'extrait — là où un comptable le
    // cherche. Hors du bloc critique : si la note échoue, le lettrage reste bon.
    try { await documentPayout(bankMoveId, plan) }
    catch (e: any) { console.warn('[postPlan] détail du versement non publié :', e?.message) }

    return { odMoveId }
  } catch (e: any) {
    // Rollback complet : on ne laisse ni OD orpheline, ni extrait à moitié
    // basculé — un extrait dont la contrepartie a quitté le compte d'attente
    // passe pour lettré alors que rien ne l'est, et disparaît de la file.
    if (bankLineMoved) {
      // On restitue la contrepartie D'ORIGINE : une seule ligne, en compte
      // d'attente, au montant crédité. Laisser N lignes éclatées derrière un
      // échec rendrait l'extrait illisible et le versement irrécupérable.
      // On restitue la contrepartie D'ORIGINE : une seule ligne, en compte
      // d'attente, au montant crédité. Laisser N lignes éclatées derrière un
      // échec rendrait l'extrait illisible et le versement irrécupérable.
      try {
        const parts = await odooRpc<any[]>('account.move.line', 'search_read', [[
          ['move_id', '=', bankMoveId], ['account_id', 'in', [ACC.outstanding, ACC.suspense]],
        ]], { fields: ['id'], limit: 200 })
        await odooRpc('account.move', 'button_draft', [[bankMoveId]])
        try {
          await odooRpc('account.move', 'write', [[bankMoveId], {
            line_ids: [
              [1, parts[0]?.id ?? suspenseLineId, {
                account_id: ACC.suspense, partner_id: originalPartner, name: false,
                debit: 0, credit: plan.net, amount_currency: -plan.net,
              }],
              ...parts.slice(1).map(l => [2, l.id, false]),
            ],
          }])
        } finally {
          await odooRpc('account.move', 'action_post', [[bankMoveId]])
        }
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

/**
 * Écrit le détail du versement dans le fil de discussion de l'extrait.
 *
 * Le montage lettre N paiements carte contre une seule ligne bancaire : Odoo
 * n'affiche alors qu'une ligne « Paiements entrants en suspens » et le détail
 * n'existe que dans le lettrage, qu'il faut déplier rapprochement par
 * rapprochement. Cette note met tout à plat, à l'endroit où on la cherche.
 * Olivier 2026-08-24 : « quand il y a plusieurs rapprochements je ne vois pas
 * le détail dans Odoo ».
 */
async function documentPayout(bankMoveId: number, plan: PostingPlan): Promise<void> {
  const eur = (n: number) => n.toFixed(2).replace('.', ',') + ' €'
  const jour = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')
  const heure = (iso: string | null) => (iso && iso.length > 12 ? ` ${iso.slice(11, 16)}` : '')

  const rows = plan.detail.map(d => `
    <tr>
      <td style="padding:2px 8px 2px 0;white-space:nowrap">${jour(d.at)}${heure(d.at)}</td>
      <td style="padding:2px 8px 2px 0;text-align:right;white-space:nowrap"><b>${eur(d.amount)}</b></td>
      <td style="padding:2px 8px 2px 0">${d.invoice || '<i>sans facture</i>'}</td>
      <td style="padding:2px 8px 2px 0">${d.partner || ''}</td>
      <td style="padding:2px 8px 2px 0;color:#888">${[d.card, d.ref ? `réf. ${d.ref}` : '', d.note || ''].filter(Boolean).join(' · ')}</td>
    </tr>`).join('')

  const body =
    `<p><b>Versement ${plan.od?.ref || plan.payoutId}</b> — ${plan.detail.length} paiement`
    + `${plan.detail.length > 1 ? 's' : ''} carte pour ${eur(plan.gross)} brut,`
    + ` ${eur(plan.net)} crédités.</p>`
    + `<table style="border-collapse:collapse;font-size:13px">${rows}</table>`
    + (plan.commission > 0.005
        ? `<p>Commission retenue à la source : <b>${eur(plan.commission)}</b> — passée en OD sur le compte fournisseur.</p>`
        : '')
    + (plan.unallocatedTotal
        ? `<p>Dont <b>${eur(plan.unallocatedTotal)}</b> sans facture identifiée, en attente d'affectation sur le compte 499000.</p>`
        : '')
    + (plan.roundingTotal
        ? `<p>Écart d'arrondi absorbé : ${eur(plan.roundingTotal)}.</p>`
        : '')

  await postChatterMessage('account.move', bankMoveId, body)
}
