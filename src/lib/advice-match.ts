// ============================================================
// VERVIERS DÉPANNAGE — Rapprochement des paiements assureurs
// ============================================================
//
// Apparie l'avis de paiement (mail) avec le virement (banque) et les factures
// (Odoo). Calcul pur : aucune écriture n'est produite ici.
//
// L'avis arrive AVANT le virement (mesuré : J+0 à J+1 chez IMA). Un avis sans
// virement n'est donc pas une anomalie, c'est un encaissement attendu — d'où
// quatre états et non deux :
//
//   pending    avis reçu, virement pas encore arrivé → prévision de trésorerie
//   ready      les deux présents, factures retrouvées, montants concordants
//   gap        les deux présents, mais le détail ne couvre pas le virement
//   miss       une référence de l'avis ne correspond à aucune facture
//   orphan     virement arrivé sans avis → l'utilisateur joint le document
//   done       virement déjà lettré → sort de la file, reste consultable
//
// ⚠️ LE CONTRÔLE SE FAIT CONTRE LE VIREMENT, PAS CONTRE L'AVIS.
// Vérifier « somme des lignes == total imprimé » ne prouve rien quand les deux
// sortent de la même lecture : une extraction cohérente mais fausse passe au
// vert. Le montant crédité en banque est la seule donnée que ni le modèle ni le
// parseur ne peuvent influencer.
//
// Différence avec Paynovate : l'argent n'a pas été encaissé au préalable, donc
// pas de compte d'attente, pas d'OD, pas de commission — on lettre la ligne
// bancaire directement contre les factures clients.

import { odooRpc }        from '@/lib/odoo'
import { readAllAdvices, type PaymentAdvice } from '@/lib/payment-advices'

export type AdviceState = 'pending' | 'ready' | 'gap' | 'miss' | 'orphan' | 'done'

/** Qui paie, et comment on le reconnaît en banque. */
export const PAYERS = [
  { key: 'ima', label: 'IMA Benelux (Ethias)', partnerId: 16, labelMatch: 'IMA BENELUX' },
  { key: 'awp', label: 'AWP / Mondial',        partnerId: 45, labelMatch: 'AWP' },
] as const

/** Fenêtre d'appariement avis → virement, en jours. */
const WINDOW_DAYS = 10

export interface MatchedInvoice {
  ref:          string          // ce qu'annonce l'avis
  amount:       number          // montant annoncé
  invoiceId:    number | null
  invoiceName:  string | null
  invoiceTotal: number | null
  residual:     number | null
  paymentState: string | null
  matchedBy:    'numéro' | 'référence interne' | null
  issue:        'introuvable' | 'écart' | 'déjà soldée' | null
}

export interface MatchedAdvicePayment {
  state:       AdviceState
  payer:       string
  payerLabel:  string
  /** Côté avis (absent sur un orphelin). */
  advice:      { mailId: string; subject: string; receivedAt: string; reference: string | null; total: number } | null
  /** Côté banque (absent sur un avis en attente). */
  bank:        { lineId: number; date: string; amount: number; moveName: string } | null
  invoices:    MatchedInvoice[]
  /** Somme des lignes retenues, à comparer au virement. */
  linesSum:    number
  delta:       number
  blocking:    string[]
}

export interface AdviceReport {
  items: MatchedAdvicePayment[]
  totals: {
    pendingAmount: number      // annoncé, pas encore reçu
    readyCount:    number
    readyAmount:   number
    orphanCount:   number
    orphanAmount:  number
    doneCount:     number
    toDecide:      number      // gap + miss
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)

/**
 * Les virements de nos assureurs, lettrés ou non.
 *
 * ⚠️ Ne PAS filtrer sur `is_reconciled = false` : un avis dont le virement a
 * déjà été lettré verrait son virement disparaître et resterait éternellement
 * « attendu ». On récupère les deux et on distingue ensuite.
 */
async function insurerBankLines(sinceIso: string) {
  const partnerIds = PAYERS.map(p => p.partnerId)
  return odooRpc<any[]>('account.bank.statement.line', 'search_read', [[
    ['amount', '>', 0],
    ['date', '>=', sinceIso.slice(0, 10)],
    ['partner_id', 'in', partnerIds],
  ]], {
    fields: ['id', 'date', 'amount', 'payment_ref', 'move_id', 'partner_id', 'is_reconciled'],
    order: 'date desc, id desc',
    limit: 300,
  })
}

/**
 * Les factures correspondant aux références d'un avis.
 * Deux chemins : le numéro Odoo (`name`, cas IMA) et la référence interne de
 * l'assureur (`ref`, cas des autofactures AWP « 2026SELF… »).
 */
async function invoicesByRefs(refs: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  const wanted = [...new Set(refs.map(r => r.trim()).filter(Boolean))]
  if (!wanted.length) return map

  const rows = await odooRpc<any[]>('account.move', 'search_read', [[
    '|', ['name', 'in', wanted], ['ref', 'in', wanted],
  ]], {
    fields: ['id', 'name', 'ref', 'amount_total', 'amount_residual', 'payment_state', 'move_type'],
    limit: wanted.length * 2 + 50,
  })

  for (const r of rows) {
    if (r.name && wanted.includes(r.name)) map.set(r.name, { ...r, _by: 'numéro' })
    if (r.ref  && wanted.includes(r.ref))  map.set(r.ref,  { ...r, _by: 'référence interne' })
  }
  return map
}

/** Résout les lignes d'un avis en factures Odoo. */
function resolveLines(advice: PaymentAdvice, invoices: Map<string, any>): MatchedInvoice[] {
  return advice.lines.map(l => {
    const inv = invoices.get(l.invoiceRef.trim())
    if (!inv) {
      return {
        ref: l.invoiceRef, amount: l.amount,
        invoiceId: null, invoiceName: null, invoiceTotal: null, residual: null,
        paymentState: null, matchedBy: null, issue: 'introuvable' as const,
      }
    }
    // Un avoir porte un montant positif dans Odoo mais se déduit du virement.
    const signed = inv.move_type === 'out_refund' ? -Number(inv.amount_total) : Number(inv.amount_total)
    const fits   = Math.abs(signed - l.amount) < 0.02
    const paid   = inv.payment_state === 'paid'

    return {
      ref: l.invoiceRef, amount: l.amount,
      invoiceId: inv.id, invoiceName: inv.name,
      invoiceTotal: r2(signed), residual: r2(Number(inv.amount_residual)),
      paymentState: inv.payment_state,
      matchedBy: inv._by,
      issue: !fits ? 'écart' : paid ? 'déjà soldée' : null,
    }
  })
}

/**
 * Construit le rapport.
 *
 * @param monthsBack profondeur de lecture des mails et des virements.
 */
export async function buildAdviceReport(monthsBack = 2): Promise<AdviceReport> {
  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - monthsBack)
  const sinceIso = since.toISOString()

  const [advices, lines] = await Promise.all([
    readAllAdvices(sinceIso),
    insurerBankLines(sinceIso),
  ])

  const invoices = await invoicesByRefs(advices.flatMap(a => a.lines.map(l => l.invoiceRef)))

  const items: MatchedAdvicePayment[] = []
  const usedLineIds = new Set<number>()

  for (const advice of advices) {
    const payer = PAYERS.find(p => p.key === advice.provider)!
    const resolved = resolveLines(advice, invoices)
    const linesSum = r2(resolved.reduce((s, x) => s + x.amount, 0))

    // Appariement : même payeur, montant du virement égal à la somme des
    // lignes, et virement postérieur à l'avis dans la fenêtre.
    const bank = lines.find(l => {
      if (usedLineIds.has(l.id)) return false
      const pid = Array.isArray(l.partner_id) ? l.partner_id[0] : l.partner_id
      if (Number(pid) !== payer.partnerId) return false
      if (Math.abs(Number(l.amount) - linesSum) > 0.02) return false
      const gap = daysBetween(advice.receivedAt.slice(0, 10), l.date)
      return gap >= -2 && gap <= WINDOW_DAYS
    })
    if (bank) usedLineIds.add(bank.id)

    const blocking: string[] = []
    for (const x of resolved) {
      if (x.issue === 'introuvable') blocking.push(`Aucune facture pour la référence ${x.ref}`)
      if (x.issue === 'écart')       blocking.push(`${x.invoiceName} : ${x.amount.toFixed(2)} € annoncés pour une facture de ${(x.invoiceTotal ?? 0).toFixed(2)} €`)
      if (x.issue === 'déjà soldée') blocking.push(`${x.invoiceName} est déjà soldée dans Odoo`)
    }
    for (const w of advice.warnings) blocking.push(w)

    const delta = bank ? r2(linesSum - Number(bank.amount)) : 0
    if (bank && Math.abs(delta) > 0.02) {
      blocking.push(`Le détail totalise ${linesSum.toFixed(2)} € pour un virement de ${Number(bank.amount).toFixed(2)} €`)
    }

    const state: AdviceState =
      !bank                                          ? 'pending'
      : bank.is_reconciled                           ? 'done'
      : resolved.some(x => x.issue === 'introuvable') ? 'miss'
      : blocking.length                              ? 'gap'
      : 'ready'

    items.push({
      state,
      payer: payer.key, payerLabel: payer.label,
      advice: {
        mailId: advice.mailId, subject: advice.subject, receivedAt: advice.receivedAt,
        reference: advice.reference, total: advice.total,
      },
      bank: bank ? {
        lineId: bank.id, date: bank.date, amount: Number(bank.amount),
        moveName: Array.isArray(bank.move_id) ? bank.move_id[1] : '',
      } : null,
      invoices: resolved,
      linesSum, delta, blocking,
    })
  }

  // Virements sans avis : l'utilisateur joindra le document.
  for (const l of lines) {
    if (usedLineIds.has(l.id) || l.is_reconciled) continue
    const pid   = Array.isArray(l.partner_id) ? l.partner_id[0] : l.partner_id
    const payer = PAYERS.find(p => p.partnerId === Number(pid))
    items.push({
      state: 'orphan',
      payer: payer?.key ?? 'inconnu', payerLabel: payer?.label ?? 'Payeur inconnu',
      advice: null,
      bank: { lineId: l.id, date: l.date, amount: Number(l.amount), moveName: Array.isArray(l.move_id) ? l.move_id[1] : '' },
      invoices: [], linesSum: 0, delta: 0,
      blocking: ['Aucun avis de paiement trouvé pour ce virement — joins le document reçu'],
    })
  }

  items.sort((a, b) => {
    const da = a.bank?.date ?? a.advice?.receivedAt.slice(0, 10) ?? ''
    const db = b.bank?.date ?? b.advice?.receivedAt.slice(0, 10) ?? ''
    return db.localeCompare(da)
  })

  const by = (s: AdviceState) => items.filter(i => i.state === s)
  const sum = (xs: MatchedAdvicePayment[], f: (i: MatchedAdvicePayment) => number) => r2(xs.reduce((t, i) => t + f(i), 0))

  return {
    items,
    totals: {
      pendingAmount: sum(by('pending'), i => i.linesSum),
      readyCount:    by('ready').length,
      readyAmount:   sum(by('ready'), i => i.bank?.amount ?? 0),
      orphanCount:   by('orphan').length,
      orphanAmount:  sum(by('orphan'), i => i.bank?.amount ?? 0),
      doneCount:     by('done').length,
      toDecide:      by('gap').length + by('miss').length,
    },
  }
}
