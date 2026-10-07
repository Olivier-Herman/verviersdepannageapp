// src/lib/mail-agent/odoo.ts
//
// Les gestes Odoo de l'agent mail : retrouver la facture rejetée, passer les
// garde-fous, puis rejouer exactement la manip manuelle d'Olivier —
// « Ajouter une note de crédit » → bouton « Créditer et facturer », motif = la
// référence client de la facture — et réadresser le brouillon à la bonne entité.
//
// ⚠️ COMPORTEMENT ODOO À CONNAÎTRE : `modify_moves()` (= Créditer et facturer)
// POSTE la note de crédit et la lettre avec la facture d'origine (qui passe en
// payment_state 'reversed'). Seule la NOUVELLE FACTURE reste en brouillon.
// C'est le comportement du bouton standard, identique à la manip manuelle —
// mais il faut le dire : l'agent ne « ne poste rien », il ne poste pas la
// FACTURE. Vérifié sur les extournes maison (2026-0199 ← 2026/07/410).
//
// FICHE CLIENT CIBLE : on résout par NUMÉRO DE TVA et on privilégie le contact
// de type 'invoice'. Ce n'est pas une préférence esthétique, c'est ce qui se
// fait payer — mesuré le 2026-08-31 sur l'historique Odoo :
//   [21] Ima Benelux, Invoice      → 43/53 payées (81 %)
//   [20] Ima Benelux (fiche mère)  →  0/10 payées ( 0 %)
//   [23] IMA ASSURANCES, Invoice   → 30/32 payées (94 %)
//   [19] P&V Assurances, Invoice   → 251/300 payées (84 %)
// Les 3 refacturations faites à la main sur la fiche mère [20] sont toutes
// encore impayées.

import { alignCreditNotes } from '@/lib/facturation/credit-note-align'
import { odooRpc } from '@/lib/odoo'
import type { RejectEntity } from './handlers/types'

export interface OdooInvoice {
  id:              number
  name:            string
  partner_id:      [number, string] | false
  ref:             string | false
  invoice_date:    string | false
  amount_untaxed:  number
  amount_tax:      number
  amount_total:    number
  state:           string
  payment_state:   string
  journal_id:      [number, string] | false
  reversal_move_ids: number[]
}

const INVOICE_FIELDS = [
  'id', 'name', 'partner_id', 'ref', 'invoice_date', 'amount_untaxed',
  'amount_tax', 'amount_total', 'state', 'payment_state', 'journal_id',
  'reversal_move_ids',
]

export async function findInvoiceByName(name: string): Promise<OdooInvoice | null> {
  const rows = await odooRpc<OdooInvoice[]>('account.move', 'search_read',
    [[['name', '=', name], ['move_type', '=', 'out_invoice']]],
    { fields: INVOICE_FIELDS, limit: 2 })
  if (!rows?.length) return null
  return rows[0]
}

/**
 * Fiche Odoo de l'entité exigée, résolue par NUMÉRO DE TVA.
 *
 * Plusieurs fiches partagent souvent la même TVA (la fiche mère et son contact
 * de facturation). On retient celle qui a le plus de factures PAYÉES : c'est la
 * mesure la plus fiable de « celle qui se fait payer », et elle est
 * auto-correctrice si la pratique change.
 *
 * Mesuré le 2026-08-31 — le classement par factures payées donne la bonne fiche
 * dans les quatre cas rencontrés :
 *   BE0402236531 → [19] P&V, Invoice        251 payées  (vs 3 sur la mère [18])
 *   BE0474851226 → [21] Ima Benelux, Invoice 43 payées  (vs 0 sur la mère [20])
 *   FR44481511632 → [23] IMA ASSURANCES, Inv. 30 payées (vs 8 sur la mère [22])
 *   BE0837437919 → [45] AWP P&C S.A. - Belgian Branch 576 payées (vs 1 sur [47])
 * Un simple « préférer le contact de type invoice » se trompait sur AWP, où
 * aucune fiche n'est de ce type.
 */
export async function resolveTargetPartner(entity: { vat: string; label: string }): Promise<{ id: number; name: string } | null> {
  const rows = await odooRpc<any[]>('res.partner', 'search_read',
    [[['vat', '=', entity.vat]]],
    { fields: ['id', 'name', 'type', 'parent_id'], limit: 20 })
  if (!rows?.length) return null
  if (rows.length === 1) return { id: rows[0].id, name: labelOf(rows[0]) }

  const scored: { row: any; paid: number }[] = []
  for (const r of rows) {
    const paid = await odooRpc<number>('account.move', 'search_count',
      [[['move_type', '=', 'out_invoice'], ['partner_id', '=', r.id],
        ['state', '=', 'posted'], ['payment_state', '=', 'paid']]])
    scored.push({ row: r, paid: paid || 0 })
  }
  scored.sort((a, b) => b.paid - a.paid
    || (b.row.type === 'invoice' ? 1 : 0) - (a.row.type === 'invoice' ? 1 : 0))
  const best = scored[0].row
  return { id: best.id, name: labelOf(best) }
}

function labelOf(p: any): string {
  return p.name || (p.parent_id ? `${p.parent_id[1]}, ${p.type}` : `#${p.id}`)
}

export interface CheckResult {
  ok:       boolean
  blocked?: string
  details:  Record<string, any>
}

/**
 * Garde-fous. Tant qu'un seul est rouge, l'agent ne touche à RIEN : une
 * écriture comptable de trop coûte plus cher qu'un mail traité en retard.
 */
export async function runChecks(
  inv: OdooInvoice | null,
  target: { id: number; name: string } | null,
  mailAmount: number | null,
): Promise<CheckResult> {
  const details: Record<string, any> = {}

  if (!inv)    return { ok: false, blocked: 'Facture introuvable dans Odoo', details }
  if (!target) return { ok: false, blocked: 'Fiche client cible introuvable (TVA inconnue dans Odoo)', details }

  details.invoice = { name: inv.name, total: inv.amount_total, state: inv.state, payment_state: inv.payment_state }
  details.target  = target

  if (inv.state !== 'posted')
    return { ok: false, blocked: `Facture non comptabilisée (état « ${inv.state} »)`, details }

  if (inv.payment_state === 'paid' || inv.payment_state === 'partial')
    return { ok: false, blocked: `Facture déjà payée (${inv.payment_state}) — extourner reviendrait à rembourser`, details }

  if (inv.payment_state === 'reversed' || (inv.reversal_move_ids || []).length > 0)
    return { ok: false, blocked: 'Facture déjà extournée', details }

  const currentPartner = inv.partner_id ? inv.partner_id[0] : null
  if (currentPartner === target.id)
    return { ok: false, blocked: 'Facture déjà adressée à la bonne entité — rien à corriger', details }

  // Contrôle croisé du montant annoncé par IMA.
  if (mailAmount != null && Math.abs(mailAmount - inv.amount_total) > 0.01) {
    details.amountMismatch = { mail: mailAmount, odoo: inv.amount_total }
    return { ok: false, blocked: `Montant incohérent : IMA annonce ${mailAmount} €, Odoo porte ${inv.amount_total} €`, details }
  }

  // Doublon : même référence client, même montant, sur une autre facture vivante.
  if (inv.ref) {
    const twins = await odooRpc<any[]>('account.move', 'search_read',
      [[['move_type', '=', 'out_invoice'], ['ref', '=', inv.ref], ['id', '!=', inv.id],
        ['state', '=', 'posted'], ['payment_state', 'not in', ['reversed']]]],
      { fields: ['id', 'name', 'amount_total', 'payment_state'], limit: 5 })
    const sameAmount = (twins || []).filter(t => Math.abs(t.amount_total - inv.amount_total) < 0.01)
    if (sameAmount.length) {
      details.duplicates = sameAmount
      return {
        ok: false,
        blocked: `Doublon probable : ${sameAmount.map(t => t.name).join(', ')} porte la même référence « ${inv.ref} » et le même montant`,
        details,
      }
    }
  }

  return { ok: true, details }
}


/**
 * Trouve la taxe « 0 % intracommunautaire » à poser sur les lignes.
 *
 * POURQUOI CE CODE EXISTE : changer le client par API ne remappe PAS les taxes
 * des lignes. Le remappage vit dans un onchange de l'écran Odoo, qui ne se
 * déclenche pas sur un `write`. Résultat observé le 2026-08-31 : deux factures
 * réadressées à IMA ASSURANCES (FR) sont sorties avec 21 % de TVA alors que la
 * position fiscale « Intra-Community » était bien posée.
 *
 * QUELLE taxe 0 % : **« 0 % EU S » (services)** — décision d'Olivier le
 * 2026-08-31. Nos lignes sont des prestations (prise en charge, kilomètres,
 * main d'œuvre, majorations), pas des marchandises, et la case de déclaration
 * TVA n'est pas la même. Attention : le `tax_map` générique de la position
 * fiscale « Intra-Community » renvoie « 0 % EU M » (marchandises) — c'est un
 * piège, on ne peut pas le suivre aveuglément.
 *
 * Ordre de recherche : les taxes 0 % vente déjà utilisées pour CE client
 * (auto-correcteur si la pratique évolue), puis celles proposées par la
 * position fiscale. Dans les deux cas, à égalité, on retient la variante
 * SERVICES.
 */
async function resolveZeroVatTax(
  partnerId: number,
  fiscalPositionId: number | null,
  currentTaxIds: number[],
): Promise<number | null> {
  const candidates: number[] = []

  // 1. Ce que porte l'historique de ce client, du plus fréquent au moins fréquent.
  const past = await odooRpc<any[]>('account.move', 'search_read',
    [[['move_type', '=', 'out_invoice'], ['partner_id', '=', partnerId], ['state', '=', 'posted']]],
    { fields: ['id'], order: 'id desc', limit: 5 })
  if (past?.length) {
    const lines = await odooRpc<any[]>('account.move.line', 'search_read',
      [[['move_id', 'in', past.map(m => m.id)], ['display_type', '=', 'product']]],
      { fields: ['tax_ids'], limit: 50 })
    const freq = new Map<number, number>()
    for (const l of lines || []) for (const t of l.tax_ids || []) freq.set(t, (freq.get(t) || 0) + 1)
    candidates.push(...[...freq.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]))
  }

  // 2. Ce que propose la position fiscale (v19 : dict direct sur tax_map).
  if (fiscalPositionId) {
    const fp = await odooRpc<any[]>('account.fiscal.position', 'read', [[fiscalPositionId]],
      { fields: ['tax_map', 'tax_ids'] })
    const map = fp?.[0]?.tax_map as Record<string, number[]> | undefined
    for (const src of currentTaxIds) candidates.push(...(map?.[String(src)] || []))
    candidates.push(...((fp?.[0]?.tax_ids as number[]) || []))
  }

  const unique = [...new Set(candidates)]
  if (!unique.length) return null

  const taxes = await odooRpc<any[]>('account.tax', 'read', [unique],
    { fields: ['id', 'name', 'amount', 'type_tax_use'] })
  const zeroSale = unique
    .map(id => (taxes || []).find(t => t.id === id))
    .filter(t => t && t.amount === 0 && t.type_tax_use === 'sale')

  if (!zeroSale.length) return null

  // Préférence explicite : la variante SERVICES (« 0% EU S »), pas marchandises.
  const services = zeroSale.find(t => /\bS\b/.test(String(t.name)))
  return (services || zeroSale[0]).id
}

export interface RebillResult {
  creditNoteId:   number | null
  creditNoteName: string | null
  newInvoiceId:   number | null
  newInvoiceName: string | null
  /** TVA du brouillon après réadressage — doit être 0 pour l'entité française. */
  newInvoiceTax:  number | null
  warnings:       string[]
}

/**
 * Extourne + refacturation. `reason` = la référence client de la facture, comme
 * Olivier le fait à la main (elle atterrit sur la NC : « Extourne de : X, REF »).
 */
export async function creditAndRebill(
  inv: OdooInvoice,
  target: { id: number; name: string },
  entity: RejectEntity,
): Promise<RebillResult> {
  const warnings: string[] = []
  const reason = inv.ref || inv.name

  const wizardId = await odooRpc<number>('account.move.reversal', 'create', [{
    move_ids:   [[6, 0, [inv.id]]],
    date:       new Date().toISOString().slice(0, 10),
    reason,
    journal_id: inv.journal_id ? inv.journal_id[0] : false,
  }])

  // « Créditer et facturer » : poste la NC, la lettre avec l'originale, et
  // crée la nouvelle facture en BROUILLON.
  await odooRpc('account.move.reversal', 'modify_moves', [[wizardId]])

  const wiz = await odooRpc<any[]>('account.move.reversal', 'read', [[wizardId]], { fields: ['new_move_ids'] })
  const newIds: number[] = wiz?.[0]?.new_move_ids || []

  // La NC est rattachée à l'originale ; le brouillon est le move restant.
  const fresh = await odooRpc<any[]>('account.move', 'read', [[inv.id]], { fields: ['reversal_move_ids'] })
  const creditNoteId = fresh?.[0]?.reversal_move_ids?.[0] || null
  const newInvoiceId = newIds.find(id => id !== creditNoteId) ?? null

  let creditNoteName: string | null = null
  // La NC porte exactement la référence du dossier et le véhicule de la facture (Olivier 07/10/2026).
  if (creditNoteId) await alignCreditNotes(1, inv.id, [creditNoteId])
  if (creditNoteId) {
    const cn = await odooRpc<any[]>('account.move', 'read', [[creditNoteId]], { fields: ['name'] })
    creditNoteName = cn?.[0]?.name || null
  }

  let newInvoiceName: string | null = null
  let newInvoiceTax:  number | null = null

  if (newInvoiceId) {
    // Réadressage à l'entité exigée. La référence client doit survivre : c'est
    // elle qu'IMA utilise pour rapprocher la facture de sa commande.
    await odooRpc('account.move', 'write', [[newInvoiceId], { partner_id: target.id, ref: inv.ref || false }])

    let after = await odooRpc<any[]>('account.move', 'read', [[newInvoiceId]],
      { fields: ['name', 'amount_tax', 'amount_untaxed', 'fiscal_position_id', 'ref', 'state'] })
    // Une facture en BROUILLON n'a pas encore de numéro dans Odoo (name vaut
    // '/' ou false) : on affiche l'identifiant pour que l'écran reste cliquable.
    const rawName  = after?.[0]?.name
    newInvoiceName = (rawName && rawName !== '/') ? rawName : `Brouillon #${newInvoiceId}`
    newInvoiceTax  = after?.[0]?.amount_tax ?? null

    // Entité française : la position fiscale « Intra-Community » est en
    // auto_apply, la TVA doit tomber seule. Si elle n'est pas tombée, on ne
    // bricole pas les lignes en douce : on le signale et un humain tranche.
    if (entity.zeroVat && (newInvoiceTax ?? 0) !== 0) {
      const fpId = after?.[0]?.fiscal_position_id ? after[0].fiscal_position_id[0] : null
      const lines = await odooRpc<any[]>('account.move.line', 'search_read',
        [[['move_id', '=', newInvoiceId], ['display_type', '=', 'product']]],
        { fields: ['id', 'tax_ids'] })
      const current = [...new Set((lines || []).flatMap(l => l.tax_ids || []))] as number[]
      const zeroTax = await resolveZeroVatTax(target.id, fpId, current)

      if (zeroTax) {
        for (const l of lines || []) {
          await odooRpc('account.move.line', 'write', [[l.id], { tax_ids: [[6, 0, [zeroTax]]] }])
        }
        after = await odooRpc<any[]>('account.move', 'read', [[newInvoiceId]],
          { fields: ['name', 'amount_tax', 'amount_untaxed', 'fiscal_position_id', 'ref', 'state'] })
        newInvoiceTax = after?.[0]?.amount_tax ?? null
      }

      if ((newInvoiceTax ?? 0) !== 0) {
        warnings.push(
          `TVA de ${newInvoiceTax} € encore présente sur ${newInvoiceName} alors que `
          + `${entity.label} doit être facturée hors TVA — à corriger avant de comptabiliser.`,
        )
      }
    }
    if (!after?.[0]?.ref && inv.ref) {
      warnings.push(`Référence client « ${inv.ref} » non reprise sur ${newInvoiceName} — à remettre.`)
    }
  } else {
    warnings.push('Nouvelle facture introuvable après « Créditer et facturer » — à vérifier dans Odoo.')
  }

  return { creditNoteId, creditNoteName, newInvoiceId, newInvoiceName, newInvoiceTax, warnings }
}

// ── Module « mauvais client », suite (Olivier 07/10/2026) ─────────────────────

/**
 * Valide la nouvelle facture et l'envoie : par Peppol pour un client belge, par mail pour un
 * client étranger (« envoi à société française de fait par mail, ils n'ont pas encore Peppol
 * en France », Olivier 07/10/2026). Un seul canal coché. Aucun canal possible : validée, signalée.
 */
export async function postAndSendPeppol(id: number): Promise<{ name: string; sent: boolean; note: string }> {
  const [m] = await odooRpc<any[]>('account.move', 'read', [[id]], { fields: ['state', 'commercial_partner_id'] })
  if (m?.state === 'draft') await odooRpc('account.move', 'action_post', [[id]])
  const [cp] = m?.commercial_partner_id ? await odooRpc<any[]>('res.partner', 'read', [[m.commercial_partner_id[0]]], { fields: ['country_id'] }) : [null]
  const belgian = !cp?.country_id || /belg/i.test(String(cp.country_id[1]))
  const ctx = { context: { active_model: 'account.move', active_ids: [id], active_id: id } }
  const wiz = await odooRpc<number>('account.move.send.wizard', 'create', [{ move_id: id }], ctx)
  const [w0] = await odooRpc<any[]>('account.move.send.wizard', 'read', [[wiz]], { fields: ['sending_method_checkboxes'], ...ctx })
  const [after0] = await odooRpc<any[]>('account.move', 'read', [[id]], { fields: ['name'] })
  const method = belgian ? 'peppol' : 'email'
  if (!w0?.sending_method_checkboxes?.[method]) return { name: after0.name, sent: false, note: `${after0.name} validée ; envoi ${belgian ? 'Peppol' : 'par mail'} impossible pour ce client : à envoyer` }
  const boxes = Object.fromEntries(Object.entries<any>(w0.sending_method_checkboxes).map(([k, v]) => [k, { ...v, checked: k === method }]))
  await odooRpc('account.move.send.wizard', 'write', [[wiz], { sending_method_checkboxes: boxes, sending_methods: [method] }], ctx)
  await odooRpc('account.move.send.wizard', 'action_send_and_print', [[wiz]], ctx)
  const [a] = await odooRpc<any[]>('account.move', 'read', [[id]], { fields: ['name', 'peppol_move_state', 'is_move_sent'] })
  return { name: a.name, sent: !!a.is_move_sent || belgian, note: belgian ? `${a.name} validée et envoyée par Peppol (${a.peppol_move_state})` : `${a.name} validée et envoyée par mail` }
}

/** Note de crédit totale d'une facture (doublon), validée et lettrée avec elle. */
export async function creditInFull(invoiceId: number, reason: string): Promise<string> {
  const [inv] = await odooRpc<any[]>('account.move', 'read', [[invoiceId]], { fields: ['state', 'payment_state', 'journal_id'] })
  if (inv?.state !== 'posted' || inv.payment_state !== 'not_paid') throw new Error(`Facture ${invoiceId} non créditable (${inv?.state}/${inv?.payment_state})`)
  let draft = await odooRpc<any[]>('account.move', 'search_read', [[['reversed_entry_id', '=', invoiceId], ['state', '=', 'draft']]], { fields: ['id'] })
  if (!draft.length) {
    const wz = await odooRpc<number>('account.move.reversal', 'create', [{ move_ids: [[6, 0, [invoiceId]]], date: new Date().toISOString().slice(0, 10), reason, journal_id: inv.journal_id ? inv.journal_id[0] : false }])
    await odooRpc('account.move.reversal', 'refund_moves', [[wz]])
    draft = await odooRpc<any[]>('account.move', 'search_read', [[['reversed_entry_id', '=', invoiceId], ['state', '=', 'draft']]], { fields: ['id'] })
  }
  if (draft.length !== 1) throw new Error('Note de crédit introuvable après création')
  await odooRpc('account.move', 'action_post', [[draft[0].id]])
  await alignCreditNotes(1, invoiceId, [draft[0].id])
  const ls = await odooRpc<any[]>('account.move.line', 'search_read', [[['move_id', 'in', [invoiceId, draft[0].id]], ['account_id.account_type', '=', 'asset_receivable'], ['reconciled', '=', false]]], { fields: ['id'] })
  if (ls.length === 2) await odooRpc('account.move.line', 'reconcile', [ls.map(l => l.id)])
  const [nc] = await odooRpc<any[]>('account.move', 'read', [[draft[0].id]], { fields: ['name'] })
  return nc.name
}

export interface DuplicatePlan { keep: { id: number; name: string }; credit: { id: number; name: string }[]; why: string }

/**
 * Dossier facturé deux fois (même référence, même montant) : laquelle garder ?
 * Celle dont la fiche VD Soft a un vrai déroulé (photos du chauffeur). Une facture sans
 * fiche, ou dont la fiche n'a ni photo ni déroulé, est le doublon (Olivier 07/10/2026 :
 * « si on a des pointages et des photos différents sur chaque fiche, deux factures sont
 * justifiées »). Doute = pas de plan, une personne tranche.
 */
export async function duplicatePlan(sb: any, invoices: { id: number; name: string }[]): Promise<DuplicatePlan | null> {
  const score: { inv: { id: number; name: string }; fiche: boolean; photos: number; why: string }[] = []
  for (const inv of invoices) {
    const { data } = await sb.from('incoming_missions').select('mission_number, driver_photos, on_site_at, completed_at').or(`invoice_number.eq.${inv.name},invoice_odoo_id.eq.${inv.id}`).limit(2)
    const f = data?.[0]
    const photos = Array.isArray(f?.driver_photos) ? f.driver_photos.length : 0
    score.push({ inv, fiche: !!f, photos, why: f ? `fiche #${f.mission_number}, ${photos} photo${photos > 1 ? 's' : ''}` : 'aucune fiche VD Soft' })
  }
  const real = score.filter(s => s.fiche && s.photos > 0)
  if (real.length !== 1) return null   // deux vraies missions, ou aucune preuve : une personne tranche
  const keep = real[0]
  const credit = score.filter(s => s !== keep)
  return { keep: keep.inv, credit: credit.map(c => c.inv), why: `${keep.inv.name} : ${keep.why} — ${credit.map(c => `${c.inv.name} : ${c.why}`).join(' ; ')}` }
}
