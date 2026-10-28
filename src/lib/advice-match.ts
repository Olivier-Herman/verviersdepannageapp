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
import { cachedAdvices }  from '@/lib/advice-cache'
import { loadAllUnallocated, findUnallocated } from '@/lib/payout-unallocated'

export type AdviceState = 'pending' | 'ready' | 'gap' | 'miss' | 'orphan' | 'done'

/**
 * Qui paie, et comment on le reconnaît en banque. `partnerIds` : toutes les
 * fiches au nom desquelles arrivent les virements de ce payeur — Allianz paie
 * aussi sous « AP Solutions GmbH Belgium Branch » (126), avis BEVO492090 du
 * 30/09/2026 (Olivier 05/10/2026). `partnerId` reste la fiche principale.
 */
export const PAYERS = [
  { key: 'ima', label: 'IMA Benelux (Ethias)', partnerId: 16, partnerIds: [16],      labelMatch: 'IMA BENELUX', refMatch: /\bIMA\s+(BENELUX|ASSURANCES)\b/i },
  { key: 'awp', label: 'AWP / Mondial',        partnerId: 45, partnerIds: [45, 126], labelMatch: 'AWP',         refMatch: /\bAWP\b/i },
  { key: 'anwb', label: 'ANWB',                partnerId: 56, partnerIds: [56],      labelMatch: 'ANWB',        refMatch: /\bANWB\b/i },
] as const

const payerOf = (pid: unknown) => PAYERS.find(p => (p.partnerIds as readonly number[]).includes(Number(pid)))
/** Payeur d'une ligne de banque : par son tiers, ou par le libellé du virement quand le tiers manque ou
 *  diffère (AWP 134,82 du 15/10 sans tiers, IMA ASSURANCES du 14/10 — Olivier 23/10/2026 : « des attendus déjà reçus »). */
const payerOfLine = (l: any) => payerOf(Array.isArray(l.partner_id) ? l.partner_id[0] : l.partner_id) || PAYERS.find(p => p.refMatch.test(String(l.payment_ref || '')))

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
  issue:        'introuvable' | 'écart' | 'déjà soldée' | 'reprise' | null
  /**
   * Reprise : l'assureur déduit une facture qu'il avait déjà réglée (IMA,
   * 2026/06/055 payée le 01/07, reprise sur l'avis du 08/09). Sortie propre =
   * note de crédit (ou contestation), pas un lettrage.
   */
  creditNote?:  { id: number; name: string; state: string } | null
  /** L'assureur règle puis reprend la même facture dans le même avis : effet nul. */
  neutralisee?: boolean
  /**
   * Ligne qu'on a décidé de passer en OD, faute de facture retrouvée. Elle
   * cesse de bloquer le virement : une OD dédiée apportera son débit 542, avec
   * le commentaire saisi en libellé.
   */
  unallocated?: { amount: number; reason: string; accountId?: number; meta?: Record<string, any> | null; reopened?: boolean } | null
  /** Clé de la décision — stable : la ligne bancaire ne bouge pas. */
  linkKey?: string
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
  /** Paiement retrouvé par la communication du virement (pas d'avis) — lib/finance/communication-match.ts. */
  source?:     'avis' | 'communication'
  communication?: string
  /** Client du virement (paiement lu dans la communication : pas de payeur répertorié). */
  partnerId?:  number
  /** Informations non bloquantes (note de crédit non déduite…). */
  notes?:      string[]
  /** Notes de crédit à délettrer avant le lettrage (client qui ne les a pas déduites). */
  creditNotesToUnletter?: { lineId: number; name: string; amount: number; invoiceName: string }[]
}

export interface AdviceReport {
  items: MatchedAdvicePayment[]
  /** Quand les avis ont été lus dans la boîte mail (cron de 5 h et de midi). */
  cachedAt: string | null
  /** Avis reçus mais dont l'extraction n'a rien donné — signalés, pas masqués. */
  unreadable: { subject: string; error: string }[]
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
/** Référence telle qu'Odoo la connaît : sans ponctuation ni espace de fin (avis déjà en cache compris). */
// « *2026SELX00000064_ » (avis AP Solutions, 30/09/2026) : l'astérisque et le
// tiret bas qui encadrent le numéro ne font pas partie de la référence.
const normRef = (r: string | null | undefined) => String(r ?? '').trim().replace(/^\*+/, '').replace(/[_.,;:\s]+$/, '')
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
  const partnerIds = PAYERS.flatMap(p => [...p.partnerIds])
  return odooRpc<any[]>('account.bank.statement.line', 'search_read', [[
    ['amount', '>', 0],
    ['date', '>=', sinceIso.slice(0, 10)],
    '|', '|', ['partner_id', 'in', partnerIds], ['payment_ref', 'ilike', 'AWP'], ['payment_ref', 'ilike', 'IMA '],
  ]], {
    fields: ['id', 'date', 'amount', 'amount_residual', 'payment_ref', 'move_id', 'partner_id', 'is_reconciled'],
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
  const wanted = [...new Set(refs.map(r => normRef(r)).filter(Boolean))]
  if (!wanted.length) return map

  const rows = await odooRpc<any[]>('account.move', 'search_read', [[
    '|', ['name', 'in', wanted], ['ref', 'in', wanted],
  ]], {
    fields: ['id', 'name', 'ref', 'amount_total', 'amount_residual', 'payment_state', 'move_type', 'reversal_move_ids'],
    limit: wanted.length * 2 + 50,
  })
  // Notes de crédit déjà créées sur ces factures (reprises traitées).
  const cnIds = [...new Set(rows.flatMap((r: any) => r.reversal_move_ids || []))] as number[]
  const cnById = new Map<number, { id: number; name: string; state: string }>()
  if (cnIds.length) {
    const cns = await odooRpc<any[]>('account.move', 'read', [cnIds], { fields: ['name', 'state'] })
    for (const c of cns || []) cnById.set(c.id, { id: c.id, name: (c.name && c.name !== '/') ? c.name : `Brouillon #${c.id}`, state: c.state })
  }
  for (const r of rows) r._creditNote = (r.reversal_move_ids || []).map((id: number) => cnById.get(id)).find(Boolean) || null

  for (const r of rows) {
    if (r.name && wanted.includes(r.name)) map.set(r.name, { ...r, _by: 'numéro' })
    if (r.ref  && wanted.includes(r.ref))  map.set(r.ref,  { ...r, _by: 'référence interne' })
  }
  return map
}

/**
 * Résout les lignes d'un avis en factures Odoo.
 *
 * ⚠️ On REGROUPE d'abord par facture. Un assureur peut régler une pièce puis se
 * la reprendre dans le même avis — IMA le fait avec une ligne positive et une
 * ligne négative du même montant. Ligne à ligne, le montant négatif ne
 * correspond à rien et le versement partait en « écart » ; regroupées, les deux
 * s'annulent et la facture reste simplement ouverte, ce qui est le fait.
 */
function resolveLines(advice: PaymentAdvice, invoices: Map<string, any>): MatchedInvoice[] {
  // « 2026/01/370A » puis « 2026/01/370ACR » (AWP, avis A2526105 du 17/04) : la ligne « …CR » reprend la
  // précédente ; on les additionne pour qu'elles s'annulent (Olivier 23/10/2026).
  const refs0 = new Set(advice.lines.map(l => normRef(l.invoiceRef)))
  const base = (r: string) => (/CR$/i.test(r) && refs0.has(r.replace(/CR$/i, '')) ? r.replace(/CR$/i, '') : r)
  const parLigne = new Map<string, number>()
  for (const l of advice.lines) {
    const ref = base(normRef(l.invoiceRef))
    parLigne.set(ref, r2((parLigne.get(ref) ?? 0) + l.amount))
  }

  const vues = new Set<string>()
  return advice.lines.filter(l => {
    const ref = base(normRef(l.invoiceRef))
    if (vues.has(ref)) return false
    vues.add(ref)
    return true
  }).map(l0 => {
    const l = { ...l0, invoiceRef: base(normRef(l0.invoiceRef)), amount: parLigne.get(base(normRef(l0.invoiceRef))) ?? l0.amount }
    const inv = invoices.get(l.invoiceRef)

    // Réglée puis reprise : rien à lettrer, la facture reste due.
    if (Math.abs(l.amount) < 0.005) {
      return {
        ref: l.invoiceRef, amount: 0,
        invoiceId: inv?.id ?? null, invoiceName: inv?.name ?? null,
        invoiceTotal: inv ? r2(Number(inv.amount_total)) : null,
        residual: inv ? r2(Number(inv.amount_residual)) : null,
        paymentState: inv?.payment_state ?? null,
        matchedBy: inv?._by ?? null,
        issue: null, neutralisee: true,
      }
    }
    if (!inv) {
      return {
        ref: l.invoiceRef, amount: l.amount,
        invoiceId: null, invoiceName: null, invoiceTotal: null, residual: null,
        paymentState: null, matchedBy: null, issue: 'introuvable' as const,
      }
    }
    // Un avoir porte un montant positif dans Odoo mais se déduit du virement.
    const signed = inv.move_type === 'out_refund' ? -Number(inv.amount_total) : Number(inv.amount_total)
    // Le montant annoncé rapproche s'il vaut le TOTAL de la facture — ou son
    // SOLDE restant dû : une facture déjà réglée en partie (acompte, premier
    // avis) est payée pour ce qui reste. 2026/04/162 (14/09/2026) : 840,19 €
    // annoncés, facture de 972,08 € dont 840,19 € encore dus → « écart » à tort.
    const residual = Number(inv.amount_residual || 0)
    const fits   = Math.abs(signed - l.amount) < 0.02
      || (residual > 0 && inv.move_type !== 'out_refund' && Math.abs(residual - l.amount) < 0.02)
    const paid   = inv.payment_state === 'paid'
    // Reprise : montant négatif égal à une facture que l'assureur a déjà réglée
    // (dans un avis précédent). Rien à lettrer ici : note de crédit ou contestation.
    const reprise = l.amount < 0 && inv.move_type !== 'out_refund' && paid && Math.abs(signed + l.amount) < 0.02

    return {
      ref: l.invoiceRef, amount: l.amount,
      invoiceId: inv.id, invoiceName: inv.name,
      invoiceTotal: r2(signed), residual: r2(Number(inv.amount_residual)),
      paymentState: inv.payment_state,
      matchedBy: inv._by,
      issue: reprise ? 'reprise' : !fits ? 'écart' : paid ? 'déjà soldée' : null,
      creditNote: inv._creditNote || null,
    }
  })
}

/**
 * Construit le rapport.
 *
 * Les avis viennent du CACHE (`payment_advices`), rempli par le cron de 5 h et
 * de midi. Relire la boîte mail à chaque affichage coûtait 30 à 90 secondes
 * pour un résultat identique : un avis reçu ne change plus jamais.
 *
 * @param monthsBack profondeur de lecture des avis et des virements.
 * @param opts.live  relit la boîte mail au lieu du cache — dépannage seulement.
 */
export async function buildAdviceReport(
  monthsBack = 2,
  opts: { live?: boolean } = {},
): Promise<AdviceReport> {
  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - monthsBack)
  const sinceIso = since.toISOString()

  const [cache, lines] = await Promise.all([
    opts.live
      ? readAllAdvices(sinceIso).then(advices => ({ advices, fetchedAt: new Date().toISOString(), failed: [] }))
      : cachedAdvices(sinceIso),
    insurerBankLines(sinceIso),
  ])
  const advices = cache.advices

  // Détail reçu longtemps après le virement : on va chercher, hors fenêtre, les virements dont la
  // communication cite la référence d'un avis (une seule requête).
  const known = new Set(lines.map(l => l.id))
  const refs = [...new Set(advices.map(a => String(a.reference || '').replace(/\s+/g, '').slice(0, 16)).filter(r => r.length >= 8))]
  if (refs.length) {
    const ors = refs.map(r => ['payment_ref', 'ilike', r] as any)
    const dom: any[] = [['amount', '>', 0], ['date', '<', sinceIso.slice(0, 10)], ...Array(ors.length - 1).fill('|'), ...ors]
    try {
      const old = await odooRpc<any[]>('account.bank.statement.line', 'search_read', [dom], { fields: ['id', 'date', 'amount', 'payment_ref', 'move_id', 'partner_id', 'is_reconciled'], limit: 100 })
      for (const l of old) if (!known.has(l.id)) lines.push(l)
    } catch (e: any) { console.error('[advice-match] virements anciens KO:', e?.message) }
  }

  const invoices = await invoicesByRefs(advices.flatMap(a => a.lines.map(l => l.invoiceRef)))

  // Les lignes déjà passées en OD — chargées en bloc, une requête pour l'écran.
  const unallocated = await loadAllUnallocated('assureur')

  const items: MatchedAdvicePayment[] = []
  const usedLineIds = new Set<number>()

  for (const advice of advices) {
    const payer = PAYERS.find(p => p.key === advice.provider)!
    let resolved = resolveLines(advice, invoices)
    let linesSum = r2(resolved.reduce((s, x) => s + x.amount, 0))   // les neutralisées valent 0

    // Appariement : même payeur, montant du virement égal à la somme des
    // lignes, et virement postérieur à l'avis dans la fenêtre.
    let bank = lines.find(l => {
      if (usedLineIds.has(l.id)) return false
      if (payerOfLine(l)?.key !== payer.key) return false
      if (Math.abs(Number(l.amount) - linesSum) > 0.02) return false
      // La référence de l'avis citée dans la communication suffit, quelle que soit la date : le détail
      // peut arriver des mois après le virement (AWP 2 829,41 payé le 17/04, détail reçu le 05/10/2026).
      const n = (x: string) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      const refAvis = n(advice.reference || "").slice(0, 16)
      if (refAvis.length >= 8 && n(l.payment_ref).includes(refAvis)) return true
      const gap = daysBetween(advice.receivedAt.slice(0, 10), l.date)
      return gap >= -2 && gap <= WINDOW_DAYS
    })
    // Virement que l'ERP a déjà lettré EN PARTIE (il rapproche seul la première facture qu'il reconnaît — Olivier
    // 28/10/2026) : il ne passe pas au montant entier. On cherche alors, chez le même payeur, une ligne dont le RESTE à
    // lettrer égale la somme des factures encore ouvertes de l'avis ; les factures déjà lettrées sortent du lettrage.
    let partiel: { reste: number; deja: string[] } | null = null
    if (!bank) {
      const ouvertes = resolved.filter(x => x.issue !== 'déjà soldée')
      const deja = resolved.filter(x => x.issue === 'déjà soldée')
      const sOuv = r2(ouvertes.reduce((s, x) => s + x.amount, 0))
      if (deja.length && ouvertes.length) {
        const cand = lines.find(l => {
          if (usedLineIds.has(l.id) || l.is_reconciled || payerOfLine(l)?.key !== payer.key) return false
          const reste = r2(Math.abs(Number(l.amount_residual || 0)))
          if (!(reste > 0.005 && reste < Number(l.amount) - 0.005) || Math.abs(reste - sOuv) > 0.02) return false
          const gap = daysBetween(advice.receivedAt.slice(0, 10), l.date)
          return gap >= -2 && gap <= WINDOW_DAYS
        })
        if (cand) { bank = cand; resolved = ouvertes; linesSum = sOuv; partiel = { reste: sOuv, deja: deja.map(x => x.invoiceName || x.ref) } }
      }
    }
    if (bank) usedLineIds.add(bank.id)

    // Décisions humaines « passer cette ligne en OD ». La clé s'appuie sur la
    // ligne bancaire, qui ne bouge pas — contrairement au mail d'avis, dont
    // l'identifiant change quand il change de dossier.
    for (const x of resolved) {
      if (!bank) continue
      x.linkKey = `${bank.id}:${x.ref}`
      const od = findUnallocated(unallocated, x.linkKey, x.amount)
      if (od) {
        x.unallocated = { amount: od.amount, reason: od.reason, accountId: od.accountId, meta: od.meta ?? null, reopened: od.accountId === 206 }
        x.issue = null            // elle ne bloque plus : l'OD apportera son débit
      }
    }

    const blocking: string[] = []
    for (const x of resolved) {
      if (x.neutralisee || x.unallocated) continue   // réglée puis reprise, ou passée en OD
      if (x.issue === 'introuvable') blocking.push(`Aucune facture pour la référence ${x.ref}`)
      // Une reprise rouvre la facture : le client s'est remboursé, elle redevient
      // due (Olivier 11/09 puis 29/09/2026). Pas de note de crédit.
      if (x.issue === 'reprise')     blocking.push(`${x.invoiceName} : l'assureur reprend ${Math.abs(x.amount).toFixed(2)} € d'une facture déjà réglée — « Rouvrir la facture » pour qu'elle redevienne due`)
      if (x.issue === 'écart')       blocking.push(`${x.invoiceName} : ${x.amount.toFixed(2)} € annoncés pour une facture de ${(x.invoiceTotal ?? 0).toFixed(2)} €${x.residual != null && Math.abs((x.residual ?? 0) - (x.invoiceTotal ?? 0)) >= 0.02 ? ` (solde restant dû ${(x.residual ?? 0).toFixed(2)} €)` : ''}`)
      if (x.issue === 'déjà soldée') blocking.push(`${x.invoiceName} est déjà soldée dans Odoo`)
    }
    for (const w of advice.warnings) blocking.push(w)

    const montantBanque = partiel ? partiel.reste : Number(bank?.amount ?? 0)
    const delta = bank ? r2(linesSum - montantBanque) : 0
    if (bank && Math.abs(delta) > 0.02) {
      blocking.push(`Le détail totalise ${linesSum.toFixed(2)} € pour un virement de ${montantBanque.toFixed(2)} €`)
    }

    // Sans virement retrouvé mais toutes les factures déjà soldées : l'argent est arrivé autrement → sort de la file.
    const toutPaye = resolved.length > 0 && resolved.every(x => x.neutralisee || ['paid', 'in_payment'].includes(String(x.paymentState)))
    const state: AdviceState =
      !bank && toutPaye                              ? 'done'
      : !bank                                        ? 'pending'
      : bank.is_reconciled                           ? 'done'
      : resolved.some(x => x.issue === 'introuvable' && !x.unallocated) ? 'miss'
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
        lineId: bank.id, date: bank.date, amount: montantBanque,
        moveName: Array.isArray(bank.move_id) ? bank.move_id[1] : '',
      } : null,
      invoices: resolved,
      linesSum, delta, blocking,
      ...(partiel ? { notes: [`Déjà lettrées par l'ERP sur ce virement : ${partiel.deja.join(', ')} — reste à lettrer ${partiel.reste.toFixed(2)} €.`] } : {}),
    })
  }

  // Virements qui citent leurs factures dans la communication (Touring, particuliers…) : rapprochés par elle.
  try {
    const { communicationItems } = await import('@/lib/finance/communication-match')
    for (const it of await communicationItems(sinceIso, usedLineIds)) { items.push(it); usedLineIds.add(it.bank!.lineId) }
  } catch (e: any) { console.error('[advice-match] communication KO:', e?.message) }

  // Virements sans avis : l'utilisateur joindra le document.
  for (const l of lines) {
    if (usedLineIds.has(l.id) || l.is_reconciled) continue
    const payer = payerOfLine(l)
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
    cachedAt:   cache.fetchedAt,
    unreadable: cache.failed,
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
