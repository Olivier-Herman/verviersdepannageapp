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

import { odooRpc } from '@/lib/odoo'

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
}

export async function analyzeAchats(monthsBack = 12): Promise<AchatsAnalysis> {
  const start = periodStart(monthsBack)
  const billDom = [['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['invoice_date', '>=', start]]

  const [overviewRows, draftRows, monthRows, supplierRows, catRows, bills] = await Promise.all([
    odooRpc<any[]>('account.move', 'read_group', [billDom, ['amount_untaxed:sum'], []]),
    odooRpc<any[]>('account.move', 'read_group', [[['move_type', '=', 'in_invoice'], ['state', '=', 'draft']], ['amount_untaxed:sum'], []]),
    odooRpc<any[]>('account.move', 'read_group', [billDom, ['amount_untaxed:sum'], ['invoice_date:month']]),
    odooRpc<any[]>('account.move', 'read_group', [billDom, ['amount_untaxed:sum'], ['partner_id']]),
    odooRpc<any[]>('account.move.line', 'read_group', [
      [['move_id.move_type', '=', 'in_invoice'], ['move_id.state', '=', 'posted'], ['date', '>=', start], ['account_id.internal_group', '=', 'expense']],
      ['balance:sum'], ['account_id'],
    ]),
    odooRpc<any[]>('account.move', 'search_read', [billDom, ['partner_id', 'ref', 'invoice_date', 'amount_total']], { limit: 4000 }),
  ])

  const totalHtva = Math.round((overviewRows?.[0]?.amount_untaxed || 0))
  const count     = overviewRows?.[0]?.__count || 0

  const suppliers = (supplierRows || [])
    .filter(r => r.partner_id)
    .map(r => ({ id: r.partner_id[0], name: r.partner_id[1], htva: Math.round(r.amount_untaxed || 0), count: r.partner_id_count || 0 }))
    .sort((a, b) => b.htva - a.htva)
  const grand = suppliers.reduce((s, x) => s + x.htva, 0) || 1
  const topSuppliers = suppliers.slice(0, 15).map(s => ({ ...s, share: Math.round((s.htva / grand) * 1000) / 10 }))
  const concentrationTop5 = Math.round((suppliers.slice(0, 5).reduce((s, x) => s + x.htva, 0) / grand) * 1000) / 10

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
    const key = `${b.partner_id[0]}|${ref.toLowerCase()}`
    const g: Dup = byKey.get(key) || { supplier: b.partner_id[1], ref, amounts: [], dates: [] }
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
      suppliers: suppliers.length,
      avgTicket: count ? Math.round(totalHtva / count) : 0,
      draftCount: draftRows?.[0]?.__count || 0,
      draftHtva: Math.round(draftRows?.[0]?.amount_untaxed || 0),
    },
    byMonth, topSuppliers, concentrationTop5, byCategory, duplicates,
  }
}
