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
  unallocated: { ref: string; amount: number; reason: string }[]
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
    .map(i => ({ ref: i.invoiceName || i.ref, amount: r2(i.unallocated!.amount || i.amount), reason: i.unallocated!.reason }))

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
 * On crée un VRAI paiement client (`account.payment`) pour le virement, au lieu
 * de basculer la contrepartie de l'extrait à la main.
 *
 * Olivier, 13/08/2026 : « je dois le voir dans le paiement ». Avec la bascule
 * directe, l'extrait n'affiche qu'une ligne « Clients » face à N créances
 * lettrées : le détail n'existe que dans le lettrage, invisible à l'écran. Le
 * paiement, lui, porte nativement `reconciled_invoice_ids` — Odoo affiche la
 * liste des factures payées, et chaque facture affiche le paiement en retour.
 *
 * Trois temps :
 *   1. `account.payment.register` groupé sur les N factures → un paiement posté,
 *      factures lettrées, ligne 542 (encaissements en suspens) ouverte.
 *   2. La contrepartie de l'extrait passe de 265 à 542.
 *   3. Lettrage des deux lignes 542 : le virement rejoint son paiement.
 */
export async function postAdvicePlan(plan: AdvicePostingPlan): Promise<{ reconciled: number; paymentIds: number[] }> {
  if (plan.warnings.length) {
    throw new Error(`Rapprochement refusé : ${plan.warnings.join(' · ')}`)
  }

  // ── Vérifications AVANT toute écriture ────────────────────
  const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[plan.bankLineId]], { fields: ['move_id', 'journal_id'] })
  const bankMoveId = Array.isArray(line?.move_id) ? Number(line.move_id[0]) : Number(line?.move_id)
  if (!bankMoveId) throw new Error(`Ligne bancaire ${plan.bankLineId} sans écriture associée`)
  const journalId = Array.isArray(line?.journal_id) ? Number(line.journal_id[0]) : Number(line?.journal_id)
  if (!journalId) throw new Error(`Ligne bancaire ${plan.bankLineId} sans journal`)

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

  if (!receivables.length && plan.invoiceIds.length) {
    throw new Error('Aucune créance ouverte sur ces factures — elles ont déjà été soldées')
  }

  // Le solde dû doit couvrir le virement, sinon on lettrerait à moitié.
  // Ce que les créances doivent couvrir : le virement MOINS ce qui part en OD.
  const odSum   = r2(plan.unallocated.reduce((s, u) => s + u.amount, 0))
  const toCover = r2(plan.amount - odSum)
  const openSum = r2(receivables.reduce((s, l) => s + Number(l.amount_residual || 0), 0))
  if (openSum + 0.02 < toCover) {
    const soldees = plan.invoiceIds.length - receivables.length
    throw new Error(
      `Créances insuffisantes : ${openSum.toFixed(2)} € encore dus pour ${toCover.toFixed(2)} € à lettrer`
      + (odSum ? ` (virement ${plan.amount.toFixed(2)} € dont ${odSum.toFixed(2)} € passés en OD)` : '')
      + (soldees > 0 ? ` — ${soldees} facture(s) déjà soldée(s) par ailleurs` : '')
      + '. À traiter à la main.',
    )
  }

  // La méthode de paiement entrante du journal bancaire concerné — déduite, pas
  // codée en dur : le virement peut tomber sur l'ING comme sur le Belfius.
  const methodLineId = await inboundMethodLine(journalId)

  // ── Écritures ─────────────────────────────────────────────
  let paymentIds: number[] = []
  const odMoveIds: number[] = []
  const odLineIds: number[] = []
  let moved = false
  try {
    // Une facture peut n'avoir aucune ligne à lettrer si TOUT l'avis part en OD.
    paymentIds = plan.invoiceIds.length
      ? await registerInsurerPayments(plan, journalId, methodLineId)
      : []

    // Les lignes d'encaissement en suspens que les paiements viennent de créer.
    const moveIds = await Promise.all(paymentIds.map(paymentMoveId))
    const outstanding = moveIds.length
      ? await odooRpc<any[]>('account.move.line', 'search_read', [[
          ['move_id', 'in', moveIds],
          ['account_id', '=', OUTSTANDING],
          ['reconciled', '=', false],
        ]], { fields: ['id'], limit: 100 })
      : []
    if (outstanding.length !== paymentIds.length) {
      throw new Error(
        `${paymentIds.length} paiement(s) créé(s) mais ${outstanding.length} ligne(s) en compte d'attente`
        + ' — écriture inattendue',
      )
    }

    // UNE ÉCRITURE PAR LIGNE passée en OD, chacune avec son commentaire. C'est
    // ce qui rend le montant identifiable en compte d'attente des mois plus
    // tard : une OD groupée ne dirait que « divers ».
    for (const u of plan.unallocated) {
      const od = await postUnallocatedOd(plan, u)
      odMoveIds.push(od.moveId)
      odLineIds.push(od.lineId)
    }

    await odooRpc('account.move.line', 'write', [[suspenseLineId], {
      account_id: OUTSTANDING,
      partner_id: plan.partnerId,
      name: `Avis ${plan.payerLabel}${plan.adviceRef ? ` ${plan.adviceRef}` : ''}`
          + ` — ${plan.invoiceIds.length} facture${plan.invoiceIds.length > 1 ? 's' : ''}`
          + (plan.unallocated.length
              ? ` + ${plan.unallocated.length} ligne${plan.unallocated.length > 1 ? 's' : ''} en attente d'affectation`
              : ''),
    }])
    moved = true

    await odooRpc('account.move.line', 'reconcile', [[suspenseLineId, ...outstanding.map(l => l.id), ...odLineIds]])

    // Le détail et l'avis d'origine, là où on les cherche : sur le paiement.
    // Hors du bloc critique — si ça échoue, le lettrage reste bon.
    try { await documentPayment(plan, paymentIds) }
    catch (e: any) { console.warn('[advice-post] détail du paiement non publié :', e?.message) }

    // Trace des factures réglées puis reprises dans le même avis.
    //
    // Choix d'Olivier (13/08/2026) : une OD à deux lignes qui s'annulent, sur le
    // compte du client, plutôt qu'une simple remarque. En revenant sur le
    // paiement des mois plus tard, on voit directement pourquoi cette facture
    // n'a pas été lettrée, sans avoir à ouvrir la facture. Les deux lignes sont
    // lettrées entre elles dans la foulée : effet nul sur le solde du client et
    // rien qui traîne dans les créances ouvertes.
    for (const n of plan.neutralisees) {
      try { await postNeutralisationOd(plan, n) }
      catch (e: any) { console.warn('[advice-post] OD de reprise KO (non bloquant) :', e?.message) }
    }

    return { reconciled: receivables.length, paymentIds }
  } catch (e: any) {
    if (moved) {
      try {
        await odooRpc('account.move.line', 'write', [[suspenseLineId], {
          account_id: SUSPENSE,
          partner_id: originalPartner,
          name:       false,
        }])
      } catch { /* on remonte l'erreur d'origine */ }
    }
    // Les paiements créés partent avec le reste : sinon les factures restent
    // soldées par des paiements que plus rien ne relie à la banque.
    if (paymentIds.length) {
      try {
        await odooRpc('account.payment', 'action_draft', [paymentIds])
        await odooRpc('account.payment', 'unlink',       [paymentIds])
      } catch { /* idem */ }
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

/** La méthode d'encaissement manuelle du journal bancaire concerné. */
async function inboundMethodLine(journalId: number): Promise<number> {
  const lines = await odooRpc<any[]>('account.payment.method.line', 'search_read', [[
    ['journal_id', '=', journalId],
    ['payment_type', '=', 'inbound'],
  ]], { fields: ['id', 'name'], order: 'id', limit: 10 })
  if (!lines.length) throw new Error(`Aucune méthode d'encaissement sur le journal ${journalId}`)
  // « Paiement manuel » est celle du virement reçu ; à défaut, la première.
  return (lines.find(l => /manu/i.test(String(l.name))) || lines[0]).id
}

async function paymentMoveId(paymentId: number): Promise<number> {
  const [p] = await odooRpc<any[]>('account.payment', 'read', [[paymentId]], { fields: ['move_id'] })
  const id  = Array.isArray(p?.move_id) ? p.move_id[0] : p?.move_id
  if (!id) throw new Error(`Paiement ${paymentId} sans écriture`)
  return Number(id)
}

/**
 * Enregistre le paiement de l'avis et lettre les factures.
 *
 * ⚠️ Un virement d'assureur ne règle PAS forcément des factures d'un seul
 * débiteur : IMA paie pour Ethias, mais aussi pour Fidelia, Sos International…
 * L'assistant `account.payment.register` groupe alors PAR TIERS et crée un
 * paiement par débiteur. C'est le fait comptable — chaque créance a son
 * débiteur — et il faut donc récupérer TOUS les paiements créés, pas un seul.
 * (Ne pas le faire produisait un paiement de 149 € pour un virement de 2 927 €
 * et un virement à moitié lettré : repéré en répétition le 13/08/2026.)
 *
 * On ne passe pas de montant : c'est le solde des factures sélectionnées qui
 * fait foi. Le contrôle vient après, contre le montant du virement.
 */
async function registerInsurerPayments(
  plan: AdvicePostingPlan, journalId: number, methodLineId: number,
): Promise<number[]> {
  const ctx = { active_model: 'account.move', active_ids: plan.invoiceIds, active_id: plan.invoiceIds[0] }

  // Repère avant/après : le seul moyen fiable d'identifier ce que l'assistant
  // vient de créer, puisqu'il ne renvoie pas les ids.
  const [last] = await odooRpc<any[]>('account.payment', 'search_read', [[]], { fields: ['id'], order: 'id desc', limit: 1 })
  const floor  = Number(last?.id || 0)

  const wizardId = await odooRpc<number>('account.payment.register', 'create', [{
    payment_date:           plan.bankDate,
    journal_id:             journalId,
    payment_method_line_id: methodLineId,
    group_payment:          true,
    communication:          `Avis ${plan.payerLabel}${plan.adviceRef ? ` ${plan.adviceRef}` : ''} du ${plan.bankDate}`,
  }], { context: ctx })

  await odooRpc('account.payment.register', 'action_create_payments', [[wizardId]], { context: ctx })

  const created = await odooRpc<any[]>('account.payment', 'search_read', [[
    ['id', '>', floor],
  ]], { fields: ['id', 'amount', 'partner_id'], order: 'id' })

  if (!created.length) throw new Error('Aucun paiement créé — à vérifier dans Odoo')

  // Le total des paiements doit faire le virement, sinon on lettrerait de
  // travers. Le contrôle porte sur la banque, pas sur ce qu'on croit avoir fait.
  const total = r2(created.reduce((s, p) => s + Number(p.amount || 0), 0))
  if (Math.abs(total - plan.amount) > 0.02) {
    throw new Error(
      `Les paiements créés totalisent ${total.toFixed(2)} € pour un virement de ${plan.amount.toFixed(2)} €`
      + ' — écriture annulée',
    )
  }

  return created.map(p => p.id)
}

/**
 * Ce qui rend le paiement lisible six mois plus tard : le détail ligne à ligne
 * de l'avis, et l'avis lui-même en pièce jointe.
 *
 * Le document vient de notre cache, où le cron l'a rangé. Une fois posé dans
 * Odoo — l'archive comptable — on libère la place chez nous : c'est le cycle
 * demandé, garder le temps utile puis rendre l'espace.
 */
async function documentPayment(plan: AdvicePostingPlan, paymentIds: number[]): Promise<void> {
  const lignes = plan.invoiceNames
    .map((n, i) => `<li>${n} — ${(plan.invoiceAmounts[i] ?? 0).toFixed(2)} €</li>`)
    .join('')
  const reprises = plan.neutralisees.length
    ? `<p><b>Réglées puis reprises dans le même avis</b> (elles restent dues) :<br>`
      + plan.neutralisees.map(n => `${n.name} — ${n.amount.toFixed(2)} €`).join('<br>') + '</p>'
    : ''
  const partage = paymentIds.length > 1
    ? `<p>Ce virement règle des factures de plusieurs débiteurs : ${paymentIds.length} paiements`
      + ' ont été enregistrés, un par débiteur.</p>'
    : ''

  const corps =
    `<p><b>Avis de paiement ${plan.payerLabel}</b>${plan.adviceRef ? ` — ${plan.adviceRef}` : ''}`
    + ` · virement ${plan.bankMove} du ${plan.bankDate} · ${plan.amount.toFixed(2)} €</p>`
    + `<p>${plan.invoiceNames.length} facture${plan.invoiceNames.length > 1 ? 's' : ''} dans cet avis :</p><ul>${lignes}</ul>`
    + reprises + partage

  // La note part sur chaque paiement : quel que soit celui qu'on ouvre, on a
  // l'avis complet sous les yeux.
  for (const id of paymentIds) await postChatterMessage('account.payment', id, corps)

  if (!plan.mailId) return
  const doc = await adviceDoc(plan.mailId)
  if (!doc) return

  for (const id of paymentIds) {
    await odooRpc('ir.attachment', 'create', [[{
      name:      doc.name,
      res_model: 'account.payment',
      res_id:    id,
      type:      'binary',
      datas:     doc.b64,
      mimetype:  doc.mime,
    }]])
  }
  // Le document est archivé dans Odoo : on libère la place chez nous.
  await releaseAdviceDoc(plan.mailId, paymentIds[0])
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
  u: { ref: string; amount: number; reason: string },
): Promise<{ moveId: number; lineId: number }> {
  const label =
    `${u.amount >= 0 ? 'Encaissement' : 'Reprise'} non affecté${u.amount >= 0 ? '' : 'e'} — ${plan.payerLabel}${plan.adviceRef ? ` ${plan.adviceRef}` : ''}`
    + ` · réf. ${u.ref} · virement ${plan.bankMove} du ${plan.bankDate} — ${u.reason}`

  const [moveId] = await odooRpc<number[]>('account.move', 'create', [[{
    journal_id: OD_JOURNAL,
    date:       plan.bankDate,
    ref:        `Non affecté ${u.ref} — ${plan.bankMove}`,
    narration:  label,
    // Une reprise ou un double paiement vient EN DÉDUCTION du virement : le
    // sens de l'écriture s'inverse, sinon Odoo refuse un débit négatif.
    line_ids: u.amount >= 0 ? [
      [0, 0, { account_id: OUTSTANDING,     partner_id: plan.partnerId, name: label, debit: u.amount, credit: 0 }],
      [0, 0, { account_id: UNALLOCATED_ACC, partner_id: plan.partnerId, name: label, debit: 0, credit: u.amount }],
    ] : [
      [0, 0, { account_id: UNALLOCATED_ACC, partner_id: plan.partnerId, name: label, debit: -u.amount, credit: 0 }],
      [0, 0, { account_id: OUTSTANDING,     partner_id: plan.partnerId, name: label, debit: 0, credit: -u.amount }],
    ],
  }]])
  await odooRpc('account.move', 'action_post', [[moveId]])

  const [line] = await odooRpc<any[]>('account.move.line', 'search_read', [[
    ['move_id', '=', moveId], ['account_id', '=', OUTSTANDING],
  ]], { fields: ['id'], limit: 1 })
  if (!line) throw new Error(`OD ${u.ref} créée mais sa ligne 542 est introuvable`)
  return { moveId, lineId: line.id }
}
