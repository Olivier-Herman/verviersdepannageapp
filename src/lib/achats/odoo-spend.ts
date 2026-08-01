// ============================================================
// VERVIERS DÉPANNAGE — Module Gestion Achat : analyse des dépenses
// ------------------------------------------------------------
// Lit les FACTURES FOURNISSEURS d'Odoo (account.move in_invoice) — il n'y a
// pas de module Purchase (pas de purchase.order). Produit les agrégats du
// moteur d'optimisation : dépense totale, tendance, top fournisseurs +
// concentration, dépense par catégorie (compte de charge), doublons.
//
// Doublons = MÊME fournisseur + MÊME n° de facture (ref). Le montant seul
// sur-détecte (factures récurrentes identiques légitimes).
// ============================================================

import { achatsRpc as odooRpc, getGroupCompanyPartnerIds } from './odoo-rpc'   // connecteur multi-société dédié Achats
import { PAIE_JOURNAL_ID } from '@/lib/paie/push-odoo'   // journal des fiches de paie (regroupé en « Salaires » dans les fournisseurs)

/** 1er jour du mois, `monthsBack` mois en arrière (fenêtre glissante). */
function periodStart(monthsBack: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - (monthsBack - 1))
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

export interface AchatsAnalysis {
  periodStart: string
  monthsBack: number
  overview: { totalHtva: number; count: number; suppliers: number; avgTicket: number; draftCount: number; draftHtva: number }
  byMonth: Array<{ month: string; htva: number }>
  topSuppliers: Array<{ id: number; name: string; htva: number; count: number; share: number }>
  concentrationTop5: number
  byCategory: Array<{ account: string; amount: number }>
  duplicates: Array<{ supplier: string; ref: string; count: number; amount: number; dates: string[] }>
  excludedSuppliers: Array<{ id: number; name: string; htva: number; count: number }>
  allSuppliers: Array<{ id: number; name: string; htva: number; count: number; excluded: boolean; mergedCount: number }>
}

// Config VD Soft (répertoire fournisseurs) : fusions (child→canonical) + exclusions
// (non-achat). Stockée en app_settings, appliquée ici — Odoo n'est jamais modifié.
export interface SupplierConfig { merges: Record<string, number>; excluded: number[] }

export async function analyzeAchats(monthsBack = 12, config: SupplierConfig = { merges: {}, excluded: [] }): Promise<AchatsAnalysis> {
  const start = periodStart(monthsBack)
  const merges = config.merges || {}
  const canon  = (id: number): number => merges[id] ?? id

  // Ids à écarter des TOTAUX/catégories = fournisseurs (canoniques exclus) + leurs
  // membres fusionnés. Calculable depuis la config seule.
  const excludedSet = new Set(config.excluded || [])
  const excludedMemberIds = new Set<number>(config.excluded || [])
  for (const [child, cid] of Object.entries(merges)) {
    if (excludedSet.has(cid)) excludedMemberIds.add(Number(child))
  }
  const exclArr = [...excludedMemberIds]
  const excl    = exclArr.length ? [['partner_id', 'not in', exclArr]] : []
  // Neutralise l'intercompagnie (VD ↔ Riga ↔ DGJ) : pas un achat externe.
  const companyPartners = await getGroupCompanyPartnerIds()
  const interco = companyPartners.length ? [['commercial_partner_id', 'not in', companyPartners]] : []
  // Les fiches de paie (journal PAIE) SONT incluses dans l'analyse des dépenses
  // (catégorie « Rémunérations » + chauffeurs en fournisseurs) — Olivier 2026-08-01.
  const baseDom = [['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['invoice_date', '>=', start], ...interco]
  const billDom = [...baseDom, ...excl]   // totaux/catégories (exclusions appliquées)

  // Fournisseurs : on EXCLUT les fiches de paie (chaque chauffeur = un fournisseur
  // encombrerait la liste) et on les regroupe en une seule ligne « Salaires ».
  const notPaie = [['journal_id', '!=', PAIE_JOURNAL_ID]]
  const [overviewRows, draftRows, monthRows, supplierRows, catRows, bills, paieRow] = await Promise.all([
    odooRpc<any[]>('account.move', 'read_group', [billDom, ['amount_untaxed:sum'], []]),
    odooRpc<any[]>('account.move', 'read_group', [[['move_type', '=', 'in_invoice'], ['state', '=', 'draft']], ['amount_untaxed:sum'], []]),
    odooRpc<any[]>('account.move', 'read_group', [billDom, ['amount_untaxed:sum'], ['invoice_date:month']]),
    odooRpc<any[]>('account.move', 'read_group', [[...baseDom, ...notPaie], ['amount_untaxed:sum'], ['partner_id']]),   // fournisseurs (hors salaires)
    odooRpc<any[]>('account.move.line', 'read_group', [
      [['move_id.move_type', '=', 'in_invoice'], ['move_id.state', '=', 'posted'], ['date', '>=', start], ['account_id.internal_group', '=', 'expense'],
        ...(exclArr.length ? [['move_id.partner_id', 'not in', exclArr]] : []),
        ...(companyPartners.length ? [['move_id.commercial_partner_id', 'not in', companyPartners]] : [])],
      ['balance:sum'], ['account_id'],
    ], { context: { lang: 'fr_BE' } }),   // libellés de comptes en français
    odooRpc<any[]>('account.move', 'search_read', [billDom, ['partner_id', 'ref', 'invoice_date', 'amount_total']], { limit: 4000 }),
    odooRpc<any[]>('account.move', 'read_group', [[['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['invoice_date', '>=', start], ['journal_id', '=', PAIE_JOURNAL_ID]], ['amount_untaxed:sum'], []]),   // total salaires
  ])

  const totalHtva = Math.round((overviewRows?.[0]?.amount_untaxed || 0))
  const count     = overviewRows?.[0]?.__count || 0

  // Fournisseurs bruts (tous), puis application des FUSIONS (child → canonical).
  const rawSup = (supplierRows || []).filter(r => r.partner_id)
    .map(r => ({ id: r.partner_id[0] as number, name: r.partner_id[1] as string, htva: Math.round(r.amount_untaxed || 0), count: r.partner_id_count || 0 }))
  // Ligne unique « Salaires (personnel) » (regroupe toutes les fiches de paie).
  const paieTotal = Math.round(paieRow?.[0]?.amount_untaxed || 0)
  if (paieTotal > 0) rawSup.push({ id: -777, name: 'Salaires (personnel)', htva: paieTotal, count: paieRow?.[0]?.__count || 0 })
  const nameById = new Map(rawSup.map(s => [s.id, s.name]))
  const mergedMap = new Map<number, { id: number; name: string; htva: number; count: number; mergedCount: number }>()
  for (const s of rawSup) {
    const cid = canon(s.id)
    const g = mergedMap.get(cid) || { id: cid, name: nameById.get(cid) || s.name, htva: 0, count: 0, mergedCount: 0 }
    g.htva += s.htva; g.count += s.count; g.mergedCount += 1
    mergedMap.set(cid, g)
  }
  const allMerged = [...mergedMap.values()].sort((a, b) => b.htva - a.htva)
  const active    = allMerged.filter(s => !excludedSet.has(s.id))
  const grand     = active.reduce((s, x) => s + x.htva, 0) || 1
  const topSuppliers = active.slice(0, 15).map(s => ({ id: s.id, name: s.name, htva: s.htva, count: s.count, share: Math.round((s.htva / grand) * 1000) / 10 }))
  const concentrationTop5 = Math.round((active.slice(0, 5).reduce((s, x) => s + x.htva, 0) / grand) * 1000) / 10
  const allSuppliers = allMerged.map(s => ({ id: s.id, name: s.name, htva: s.htva, count: s.count, excluded: excludedSet.has(s.id), mergedCount: s.mergedCount }))
  const excludedSuppliers = allMerged.filter(s => excludedSet.has(s.id)).map(s => ({ id: s.id, name: s.name, htva: s.htva, count: s.count }))

  const byMonth = (monthRows || []).map(r => ({ month: r['invoice_date:month'], htva: Math.round(r.amount_untaxed || 0) }))

  const byCategory = (catRows || [])
    .filter(r => r.account_id)
    .map(r => ({ account: r.account_id[1] as string, amount: Math.round(r.balance || 0) }))
    .sort((a, b) => b.amount - a.amount)

  // Doublons : même fournisseur + même ref (n° facture fournisseur).
  type Dup = { supplier: string; ref: string; amounts: number[]; dates: string[] }
  const byKey = new Map<string, Dup>()
  for (const b of (bills || [])) {
    const ref = (b.ref || '').trim()
    if (!ref || !b.partner_id) continue
    const cid = canon(b.partner_id[0])
    const key = `${cid}|${ref.toLowerCase()}`
    const g: Dup = byKey.get(key) || { supplier: nameById.get(cid) || b.partner_id[1], ref, amounts: [], dates: [] }
    g.amounts.push(b.amount_total || 0); g.dates.push(b.invoice_date)
    byKey.set(key, g)
  }
  const duplicates = [...byKey.values()]
    .filter(g => g.dates.length > 1)
    .map(g => ({ supplier: g.supplier, ref: g.ref, count: g.dates.length, amount: Math.round(g.amounts[0]), dates: g.dates.sort() }))
    .sort((a, b) => b.amount - a.amount)

  return {
    periodStart: start, monthsBack,
    overview: {
      totalHtva, count,
      suppliers: active.length,
      avgTicket: count ? Math.round(totalHtva / count) : 0,
      draftCount: draftRows?.[0]?.__count || 0,
      draftHtva: Math.round(draftRows?.[0]?.amount_untaxed || 0),
    },
    byMonth, topSuppliers, concentrationTop5, byCategory, duplicates, excludedSuppliers, allSuppliers,
  }
}
