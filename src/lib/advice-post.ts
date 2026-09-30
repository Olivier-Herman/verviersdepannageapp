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

import { odooRpc, postChatterMessage } from '@/lib/odoo'
import { documentLettrage } from '@/lib/finance/lettrage-detail'
import { PAYERS, type MatchedAdvicePayment } from '@/lib/advice-match'
import { adviceDoc, releaseAdviceDoc }        from '@/lib/advice-cache'

/** Compte de créances clients — le même pour tous nos assureurs. */
export const RECEIVABLE = 206
/** Contrepartie par défaut d'une ligne bancaire non lettrée. */
export const SUSPENSE = 265
/** Encaissements en suspens — la charnière entre le paiement et la banque. */
export const OUTSTANDING = 542
/** Journal d'opérations diverses (MISC, société Verviers Depannage). */
export const OD_JOURNAL = 9
/** 499000 Suspense Accounts — où attendent les montants non affectés. */
export const UNALLOCATED_ACC = 265

export interface AdvicePostingPlan {
  bankLineId:  number
  bankMove:    string
  bankDate:    string
  amount:      number
  payerLabel:  string
  partnerId:   number
  /** Identifiant du mail d'avis — sert à retrouver la pièce jointe à joindre. */
  mailId:      string | null
  adviceRef:   string | null
  invoiceIds:  number[]
  invoiceNames: string[]
  /** Montant retenu par facture, pour la note de détail sur le virement. */
  invoiceAmounts: number[]
  /** Factures réglées puis reprises dans le même avis : non lettrées, annotées. */
  neutralisees: { invoiceId: number; name: string; amount: number }[]
  /**
   * Lignes de l'avis passées en OD faute de facture retrouvée. UNE ÉCRITURE PAR
   * LIGNE, chacune avec son commentaire — pour qu'on sache six mois plus tard
   * à quoi correspond chaque montant resté en compte d'attente.
   */
  unallocated: { ref: string; amount: number; reason: string; accountId?: number; creditLineId?: number | null }[]
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

  // Les factures réglées puis reprises dans le même avis restent dues : on ne
  // les lettre pas, sinon on solderait une créance que l'assureur n'a pas payée.
  // Les lignes passées en OD sortent du lettrage des créances : leur débit 542
  // viendra de leur propre écriture.
  const unallocated = item.invoices
    .filter(i => i.unallocated)
    .map(i => ({ ref: i.invoiceName || i.ref, amount: r2(i.unallocated!.amount || i.amount), reason: i.unallocated!.reason, accountId: i.unallocated!.accountId, creditLineId: i.unallocated!.meta?.credit_line_id ?? null }))

  const utiles = item.invoices.filter(i => !i.neutralisee && !i.unallocated)
  const withInvoice = utiles.filter(i => i.invoiceId)
  if (withInvoice.length !== utiles.length) {
    warnings.push('Certaines lignes de l\'avis n\'ont pas de facture retrouvée')
  }

  const neutralisees = item.invoices
    .filter(i => i.neutralisee && i.invoiceId)
    .map(i => ({ invoiceId: i.invoiceId as number, name: i.invoiceName || i.ref, amount: Math.abs(i.invoiceTotal ?? 0) }))

  return {
    bankLineId:  item.bank?.lineId ?? 0,
    bankMove:    item.bank?.moveName ?? '',
    bankDate:    item.bank?.date ?? '',
    amount:      item.bank?.amount ?? 0,
    payerLabel:  item.payerLabel,
    partnerId:   payer?.partnerId ?? 0,
    mailId:      item.advice?.mailId ?? null,
    adviceRef:   item.advice?.reference ?? null,
    invoiceIds:  withInvoice.map(i => i.invoiceId as number),
    invoiceNames: withInvoice.map(i => i.invoiceName as string),
    invoiceAmounts: withInvoice.map(i => r2(i.amount)),
    neutralisees,
    unallocated,
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
 * Écrit dans Odoo.
 *
 * UNE LIGNE D'EXTRAIT PAR FACTURE, lettrée directement avec elle — exactement
 * ce qu'on obtient en liant chaque facture soi-même dans le rapprochement
 * bancaire (Olivier 29/09/2026 : « une ligne par document détaillé dans le
 * rapprochement bancaire, comme si je liais chaque document moi-même »).
 *
 * Remplace le montage du 13/08 (paiement groupé par débiteur + compte 542) :
 * l'extrait n'y montrait qu'une ligne « Paiements entrants en suspens » et le
 * détail n'existait que dans le lettrage. Ici chaque ligne porte sa facture,
 * son client et son montant ; chaque facture affiche le virement en retour.
 *
 *   1. Contrôles (contrepartie encore en attente, créances ouvertes suffisantes).
 *   2. OD des lignes d'avis sans facture (inchangé : une OD par ligne, en 542).
 *   3. Extrait : brouillon → une ligne par facture (+ une par OD, + l'arrondi)
 *      → revalidé.
 *   4. Lettrage UN À UN : chaque ligne avec sa facture, chaque OD avec la sienne.
 */
export async function postAdvicePlan(plan: AdvicePostingPlan): Promise<{ reconciled: number; paymentIds: number[] }> {
  if (plan.warnings.length) {
    throw new Error(`Rapprochement refusé : ${plan.warnings.join(' · ')}`)
  }

  // ── Vérifications AVANT toute écriture ────────────────────
  const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[plan.bankLineId]], { fields: ['move_id', 'journal_id'] })
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
  ]], { fields: ['id', 'amount_residual', 'move_id'], limit: 300 })

  if (!receivables.length && plan.invoiceIds.length) {
    throw new Error('Aucune créance ouverte sur ces factures — elles ont déjà été soldées')
  }

  // Ce que les créances doivent couvrir : le virement MOINS ce qui part en OD.
  const odSum   = r2(plan.unallocated.reduce((s, u) => s + u.amount, 0))
  const toCover = r2(plan.amount - odSum)
  const openSum = r2(receivables.reduce((s, l) => s + Number(l.amount_residual || 0), 0))
  // Chaque facture est soldée pour son reste dû : le total doit tomber sur le
  // virement, à l'arrondi près (une ligne d'écart d'arrondi l'absorbe).
  if (Math.abs(openSum - toCover) > 0.05) {
    const soldees = plan.invoiceIds.length - new Set(receivables.map(l => l.move_id[0])).size
    throw new Error(
      `Créances ouvertes ${openSum.toFixed(2)} € pour ${toCover.toFixed(2)} € à lettrer`
      + (odSum ? ` (virement ${plan.amount.toFixed(2)} € dont ${odSum.toFixed(2)} € passés en OD)` : '')
      + (soldees > 0 ? ` — ${soldees} facture(s) déjà soldée(s) par ailleurs` : '')
      + '. À traiter à la main.',
    )
  }

  // Une ligne par facture : son reste dû, son client, son numéro.
  const invoices = plan.invoiceIds.length
    ? await odooRpc<any[]>('account.move', 'read', [plan.invoiceIds], { fields: ['id', 'name', 'partner_id', 'commercial_partner_id'] })
    : []
  const invParts = invoices.map(inv => {
    const recv = receivables.filter(l => l.move_id[0] === inv.id)
    const partner = inv.commercial_partner_id || inv.partner_id
    return {
      amount:    r2(recv.reduce((s, l) => s + Number(l.amount_residual || 0), 0)),
      partnerId: (Array.isArray(partner) ? Number(partner[0]) : plan.partnerId) as number | false,
      label:     `${inv.name} — ${Array.isArray(partner) ? partner[1] : ''}`,
      account:   RECEIVABLE,
      match:     recv.map(l => l.id),
    }
  }).filter(x => Math.abs(x.amount) > 0.005)

  // ── Écritures ─────────────────────────────────────────────
  const odMoveIds: number[] = []
  const odLineIds: number[] = []
  let moved = false
  try {
    // UNE ÉCRITURE PAR LIGNE passée en OD, chacune avec son commentaire. C'est
    // ce qui rend le montant identifiable en compte d'attente des mois plus
    // tard : une OD groupée ne dirait que « divers ».
    for (const u of plan.unallocated) {
      const od = await postUnallocatedOd(plan, u)
      odMoveIds.push(od.moveId)
      odLineIds.push(od.lineId)
    }

    const parts: { amount: number; partnerId: number | false; label: string; account: number; match: number[] }[] = [
      ...invParts,
      // ⚠️ SIGNÉ, surtout pas en valeur absolue : un avis porte des reprises et
      // des doubles paiements négatifs (BEVO492091 : −19 129,80 €).
      ...odLineIds.map((id, i) => ({
        amount:    r2(plan.unallocated[i]?.amount ?? 0),
        partnerId: plan.partnerId as number | false,
        label:     `Non affecté — ${plan.unallocated[i]?.ref ?? ''}`,
        account:   OUTSTANDING,
        match:     [id],
      })),
    ].filter(x => Math.abs(x.amount) > 0.005)

    // L'arrondi entre la somme des restes dus et le virement : sa propre ligne,
    // lisible, plutôt qu'un centime caché dans une facture.
    const residu = r2(plan.amount - parts.reduce((s, x) => s + x.amount, 0))
    if (Math.abs(residu) > 0.05) {
      throw new Error(`Éclatement incohérent : ${r2(plan.amount - residu).toFixed(2)} € répartis pour un virement de ${plan.amount.toFixed(2)} €`)
    }
    if (residu) {
      parts.push({
        amount: residu, partnerId: plan.partnerId, match: [],
        label: `Écart d'arrondi — ${plan.payerLabel}${plan.adviceRef ? ` ${plan.adviceRef}` : ''}`,
        account: residu > 0 ? ROUND_GAIN : ROUND_LOSS,
      })
    }
    if (!parts.length) throw new Error('Rien à écrire sur ce virement')

    // ⚠️ Seul chemin accepté par Odoo 19 : brouillon → écriture unique sur la
    // PIÈCE → revalidation. Cf. le commentaire détaillé dans paynovate-post.
    // Une part négative s'inscrit au DÉBIT : Odoo refuse un crédit négatif.
    const cmd = (x: typeof parts[number]) => ({
      account_id: x.account, partner_id: x.partnerId, name: x.label,
      debit:  x.amount < 0 ? -x.amount : 0,
      credit: x.amount > 0 ?  x.amount : 0,
      amount_currency: -x.amount,
    })
    await odooRpc('account.move', 'button_draft', [[bankMoveId]])
    try {
      await odooRpc('account.move', 'write', [[bankMoveId], {
        line_ids: [[1, suspenseLineId, cmd(parts[0])], ...parts.slice(1).map(x => [0, 0, cmd(x)])],
      }])
    } finally {
      await odooRpc('account.move', 'action_post', [[bankMoveId]])
    }
    moved = true

    // Lettrage UN À UN : chaque ligne d'extrait avec SA facture (ou son OD).
    // En bloc, Odoo croise les rapprochements et n'affiche plus la contrepartie.
    const fresh = await odooRpc<any[]>('account.move.line', 'search_read', [[
      ['move_id', '=', bankMoveId], ['account_id', 'in', [RECEIVABLE, OUTSTANDING]],
    ]], { fields: ['id', 'name'], order: 'id', limit: 500 })
    const freeLines = [...fresh]
    for (const x of parts) {
      if (!x.match.length) continue
      const i = freeLines.findIndex(l => l.name === x.label)
      if (i < 0) throw new Error(`Ligne « ${x.label} » introuvable après éclatement`)
      const [l] = freeLines.splice(i, 1)
      await odooRpc('account.move.line', 'reconcile', [[l.id, ...x.match]])
    }

    // Le détail et l'avis d'origine, là où on les cherche : sur l'extrait.
    // Hors du bloc critique — si ça échoue, le lettrage reste bon.
    try { await documentBankMove(plan, bankMoveId) }
    catch (e: any) { console.warn('[advice-post] détail du virement non publié :', e?.message) }

    // Trace des factures réglées puis reprises dans le même avis.
    //
    // Choix d'Olivier (13/08/2026) : une OD à deux lignes qui s'annulent, sur le
    // compte du client, plutôt qu'une simple remarque. Les deux lignes sont
    // lettrées entre elles dans la foulée : effet nul sur le solde du client.
    for (const n of plan.neutralisees) {
      try { await postNeutralisationOd(plan, n) }
      catch (e: any) { console.warn('[advice-post] OD de reprise KO (non bloquant) :', e?.message) }
    }

    return { reconciled: receivables.length, paymentIds: [] }
  } catch (e: any) {
    if (moved) {
      try {
        // On restitue la contrepartie d'origine : une seule ligne, en compte
        // d'attente, au montant du virement. Le passage en brouillon délettre.
        const [bm] = await odooRpc<any[]>('account.move', 'read', [[bankMoveId]], { fields: ['line_ids'] })
        const now = await odooRpc<any[]>('account.move.line', 'search_read', [[
          ['move_id', '=', bankMoveId], ['id', 'in', bm.line_ids], ['account_id', 'in', [RECEIVABLE, OUTSTANDING, SUSPENSE, ROUND_GAIN, ROUND_LOSS]],
        ]], { fields: ['id'], order: 'id', limit: 500 })
        await odooRpc('account.move', 'button_draft', [[bankMoveId]])
        try {
          await odooRpc('account.move', 'write', [[bankMoveId], {
            line_ids: [
              [1, now[0]?.id ?? suspenseLineId, {
                account_id: SUSPENSE, partner_id: originalPartner, name: false,
                debit: 0, credit: plan.amount, amount_currency: -plan.amount,
              }],
              ...now.slice(1).map(l => [2, l.id, false]),
            ],
          }])
        } finally {
          await odooRpc('account.move', 'action_post', [[bankMoveId]])
        }
      } catch { /* on remonte l'erreur d'origine */ }
    }
    // Les OD de compte d'attente aussi : sinon on laisse des montants parqués
    // en face d'un virement qui, lui, n'a pas bougé.
    for (const id of odMoveIds.reverse()) {
      try {
        await odooRpc('account.move', 'button_draft', [[id]])
        await odooRpc('account.move', 'unlink',       [[id]])
      } catch { /* idem */ }
    }
    throw e
  }
}

/**
 * Ce qui rend le virement lisible six mois plus tard : le détail du lettrage
 * dans l'historique de l'extrait, et l'avis lui-même en pièce jointe.
 *
 * Le document vient de notre cache, où le cron l'a rangé. Une fois posé dans
 * Odoo — l'archive comptable — on libère la place chez nous.
 */
async function documentBankMove(plan: AdvicePostingPlan, bankMoveId: number): Promise<void> {
  const reprises = plan.neutralisees.length
    ? `Réglées puis reprises dans le même avis (elles restent dues) : `
      + plan.neutralisees.map(n => `${n.name} — ${n.amount.toFixed(2)} €`).join(', ')
    : undefined
  await documentLettrage(bankMoveId, `Avis de paiement ${plan.payerLabel}${plan.adviceRef ? ` — ${plan.adviceRef}` : ''}${reprises ? ` · ${reprises}` : ''}`)

  if (!plan.mailId) return
  const doc = await adviceDoc(plan.mailId)
  if (!doc) return
  await odooRpc('ir.attachment', 'create', [[{
    name:      doc.name,
    res_model: 'account.move',
    res_id:    bankMoveId,
    type:      'binary',
    datas:     doc.b64,
    mimetype:  doc.mime,
  }]])
  // Le document est archivé dans Odoo : on libère la place chez nous.
  await releaseAdviceDoc(plan.mailId, bankMoveId)
}

/**
 * L'OD de reprise : deux lignes qui s'annulent sur le compte du client, avec
 * le motif en toutes lettres, rattachées au virement par leur référence.
 */
async function postNeutralisationOd(
  plan: AdvicePostingPlan,
  n: { invoiceId: number; name: string; amount: number },
): Promise<void> {
  const label =
    `Reprise ${plan.payerLabel} — facture ${n.name} réglée puis reprise dans l'avis de paiement `
    + `du ${plan.bankDate} (virement ${plan.bankMove}). Effet net nul : la facture reste due.`

  const [odId] = await odooRpc<number[]>('account.move', 'create', [[{
    journal_id: OD_JOURNAL,
    date:       plan.bankDate,
    ref:        `Reprise ${n.name} — ${plan.bankMove}`,
    narration:  label,
    line_ids: [
      [0, 0, { account_id: RECEIVABLE, partner_id: plan.partnerId, name: `${label} (reprise)`, debit: 0, credit: n.amount }],
      [0, 0, { account_id: RECEIVABLE, partner_id: plan.partnerId, name: `${label} (règlement)`, debit: n.amount, credit: 0 }],
    ],
  }]])
  await odooRpc('account.move', 'action_post', [[odId]])

  // On lettre les deux lignes entre elles : le solde du client ne bouge pas et
  // rien ne vient encombrer ses créances ouvertes.
  const lines = await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['move_id', '=', odId], ['account_id', '=', RECEIVABLE],
  ]], { fields: ['id'], limit: 2 })
  if (lines.length === 2) await odooRpc('account.move.line', 'reconcile', [lines.map(l => l.id)])

  // Et la même explication sur la facture, pour qui part de l'autre bout.
  try {
    await postChatterMessage('account.move', n.invoiceId,
      `<p><b>Reprise par l'assureur</b> — ${label} Une OD de constat a été passée (${plan.bankMove}).</p>`)
  } catch { /* confort */ }
}

/**
 * Une ligne d'avis qu'on n'a pas su rattacher, passée en compte d'attente.
 *
 * L'assureur a bien viré l'argent : la ligne bancaire doit pouvoir se lettrer.
 * Faute de facture, on fabrique le débit 542 qui manque, en face de 499000, et
 * le commentaire saisi devient le libellé — c'est la seule chose lisible que
 * le comptable aura en face du montant.
 *
 *     542 Encaissements en suspens   montant D   → rejoint le lettrage
 *     499000 Suspense Accounts       montant C   → reste à affecter
 *
 * @returns l'écriture créée et sa ligne 542, à joindre au lettrage.
 */
async function postUnallocatedOd(
  plan: AdvicePostingPlan,
  u: { ref: string; amount: number; reason: string; accountId?: number; creditLineId?: number | null },
): Promise<{ moveId: number; lineId: number }> {
  // Reprise rouverte (Olivier 11/09/2026) : la contrepartie n'est pas le compte
  // d'attente mais la CRÉANCE client (206) — la facture redevient due, et le
  // crédit libéré par le délettrage du paiement d'origine est lettré ici.
  const counterAcc = u.accountId || UNALLOCATED_ACC
  const label =
    `${u.accountId === RECEIVABLE ? 'Reprise — facture rouverte' : u.amount >= 0 ? 'Encaissement non affecté' : 'Reprise non affectée'} — ${plan.payerLabel}${plan.adviceRef ? ` ${plan.adviceRef}` : ''}`
    + ` · réf. ${u.ref} · virement ${plan.bankMove} du ${plan.bankDate} — ${u.reason}`

  const [moveId] = await odooRpc<number[]>('account.move', 'create', [[{
    journal_id: OD_JOURNAL,
    date:       plan.bankDate,
    ref:        `Non affecté ${u.ref} — ${plan.bankMove}`,
    narration:  label,
    // Une reprise ou un double paiement vient EN DÉDUCTION du virement : le
    // sens de l'écriture s'inverse, sinon Odoo refuse un débit négatif.
    line_ids: u.amount >= 0 ? [
      [0, 0, { account_id: OUTSTANDING, partner_id: plan.partnerId, name: label, debit: u.amount, credit: 0 }],
      [0, 0, { account_id: counterAcc,  partner_id: plan.partnerId, name: label, debit: 0, credit: u.amount }],
    ] : [
      [0, 0, { account_id: counterAcc,  partner_id: plan.partnerId, name: label, debit: -u.amount, credit: 0 }],
      [0, 0, { account_id: OUTSTANDING, partner_id: plan.partnerId, name: label, debit: 0, credit: -u.amount }],
    ],
  }]])
  await odooRpc('account.move', 'action_post', [[moveId]])

  const [line] = await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['move_id', '=', moveId], ['account_id', '=', OUTSTANDING],
  ]], { fields: ['id'], limit: 1 })
  if (!line) throw new Error(`OD ${u.ref} créée mais sa ligne 542 est introuvable`)
  // Créance rouverte : son débit 206 se lettre avec le crédit libéré (paiement
  // d'origine délettré) → les deux virements sont soldés, la facture reste due.
  if (counterAcc === RECEIVABLE && u.creditLineId) {
    const [recv] = await odooRpc<any[]>('account.move.line', 'search_read', [[['move_id', '=', moveId], ['account_id', '=', RECEIVABLE]]], { fields: ['id'], limit: 1 })
    if (recv) await odooRpc('account.move.line', 'reconcile', [[recv.id, u.creditLineId]]).catch((e: any) => console.warn('[advice-post] relettrage du crédit libéré :', e?.message))
  }
  return { moveId, lineId: line.id }
}

/** 757100 Positive Payment Differences · 657100 Negative Payment Differences. */
const ROUND_GAIN = 461
const ROUND_LOSS = 409
