// src/lib/finance/commission-nc.ts — paiement d'un garage commissionné (Car Avenue) qui déduit ses notes de crédit de
// commission (Olivier 28/10/2026 : « souvent je dois délier la NC pour la remettre en ouverte et re-lettrer comme eux
// ont payé » ; règle validée : « Oui »).
//
// La communication cite UNE facture et les NC déduites (« 2026/10/376 - NC 2026-0357 »). Méthode d'Olivier, à
// l'identique :
//   1. les NC de COMMISSION lettrées sur la facture sont déliées (elles redeviennent ouvertes) ;
//   2. le paiement + les NC citées sont lettrés sur la facture, comme le client a payé.
// Garde-fous (sinon : rien n'est touché, le cas remonte) :
//   • seulement des NC de commission (référence ou ligne « Commission ») — jamais une NC d'annulation
//     (« Erreur facturation », « Annulation ») ni un autre paiement déjà lettré sur la facture ;
//   • reste de la facture − NC citées = reste à lettrer du virement, au centime.

import { odooRpc } from '@/lib/odoo'

const RECEIVABLE = 206
const SUSPENSE = 265
const r2 = (n: number) => Math.round(n * 100) / 100

export interface PlanCommission { ok: boolean; raison?: string; facture?: string; nc?: string[]; adelier?: string[]; montant?: number }

const estCommission = (m: any, lignes: any[]) => /commission/i.test(String(m.ref || '')) || lignes.some(l => /commission/i.test(String(l.name || '')))
const estAnnulation = (m: any) => /erreur\s+factur|annulation\s+(?:erreur|de\s+la\s+facture)/i.test(String(m.ref || ''))

/** NC citées dans la communication : « 2026-0357 », « NC 2026/0297 », « NC 2026-0160/0241/0242 ». */
export function ncCitees(communication: string): string[] {
  const out = new Set<string>()
  for (const m of communication.matchAll(/\bNC\s*(20\d\d)[-/](\d{4})((?:\s*\/\s*\d{4})*)/gi)) {
    out.add(`${m[1]}-${m[2]}`)
    for (const x of (m[3] || '').split('/').map(s => s.trim()).filter(Boolean)) out.add(`${m[1]}-${x}`)
  }
  return [...out]
}

async function lignesProduit(moveIds: number[]) {
  const ls: any[] = moveIds.length ? await odooRpc('account.move.line', 'search_read', [[['move_id', 'in', moveIds], ['display_type', '=', 'product']]], { fields: ['move_id', 'name'] }) : []
  return (id: number) => ls.filter(l => l.move_id[0] === id)
}

async function ligneCreance(moveId: number) {
  const ls: any[] = await odooRpc('account.move.line', 'search_read', [[['move_id', '=', moveId], ['account_id', '=', RECEIVABLE]]], { fields: ['id', 'amount_residual', 'matched_debit_ids', 'matched_credit_ids', 'reconciled'] })
  return ls[0] || null
}

/** Plan (aucune écriture) pour un virement de reste `reste` dont la communication est `communication`. */
export async function planCommission(communication: string, reste: number, factureId: number): Promise<PlanCommission & { _f?: any; _nc?: any[]; _delier?: number[] }> {
  const noms = ncCitees(communication)
  if (!noms.length) return { ok: false, raison: 'aucune note de crédit citée' }
  const [f]: any[] = await odooRpc('account.move', 'read', [[factureId]], { fields: ['id', 'name', 'move_type', 'state', 'amount_total', 'commercial_partner_id'] })
  if (!f || f.move_type !== 'out_invoice' || f.state !== 'posted') return { ok: false, raison: 'facture introuvable' }
  const ncs: any[] = await odooRpc('account.move', 'search_read', [[['name', 'in', noms], ['move_type', '=', 'out_refund'], ['state', '=', 'posted']]], { fields: ['id', 'name', 'ref', 'amount_total', 'commercial_partner_id'] })
  if (ncs.length !== noms.length) return { ok: false, raison: `NC introuvable(s) : ${noms.filter(n => !ncs.some(x => x.name === n)).join(', ')}` }

  // Ce qui est lettré sur la facture : seulement des NC de commission, sinon on ne touche à rien.
  const lf = await ligneCreance(f.id)
  if (!lf) return { ok: false, raison: 'créance de la facture introuvable' }
  const partiels: any[] = lf.matched_credit_ids.length ? await odooRpc('account.partial.reconcile', 'read', [lf.matched_credit_ids], { fields: ['credit_move_id', 'amount'] }) : []
  const credits: any[] = partiels.length ? await odooRpc('account.move.line', 'read', [partiels.map(p => p.credit_move_id[0])], { fields: ['move_id'] }) : []
  const lettres: any[] = credits.length ? await odooRpc('account.move', 'read', [[...new Set(credits.map(c => c.move_id[0]))]], { fields: ['id', 'name', 'ref', 'move_type'] }) : []
  const prod = await lignesProduit([...lettres.map(m => m.id), ...ncs.map(n => n.id)])
  for (const m of lettres) {
    if (m.move_type !== 'out_refund') return { ok: false, raison: `${f.name} est déjà lettrée avec ${m.name}, qui n'est pas une note de crédit` }
    if (estAnnulation(m) || !estCommission(m, prod(m.id))) return { ok: false, raison: `${f.name} est annulée par ${m.name} (pas une NC de commission) : à voir à la main` }
  }
  for (const n of ncs) {
    if (n.commercial_partner_id?.[0] !== f.commercial_partner_id?.[0]) return { ok: false, raison: `${n.name} n'est pas du même client` }
    if (estAnnulation(n) || !estCommission(n, prod(n.id))) return { ok: false, raison: `${n.name} n'est pas une NC de commission` }
  }

  // Après déliage : la facture est due en entier ; chaque NC citée, pour son total (déliée si elle était lettrée ici).
  const resteFacture = r2(Number(f.amount_total))
  const sNc = r2(ncs.reduce((s, n) => s + Number(n.amount_total), 0))
  if (Math.abs(resteFacture - sNc - reste) > 0.01) return { ok: false, raison: `${f.name} ${resteFacture.toFixed(2)} € − NC ${sNc.toFixed(2)} € ≠ paiement ${reste.toFixed(2)} €` }
  // Une NC citée lettrée AILLEURS que sur cette facture : on ne la délie pas d'office.
  for (const n of ncs) {
    const ln = await ligneCreance(n.id)
    if (ln && Math.abs(Number(ln.amount_residual)) < Math.abs(Number(n.amount_total)) - 0.005 && !lettres.some(m => m.id === n.id))
      return { ok: false, raison: `${n.name} est déjà lettrée sur une autre pièce` }
  }
  return { ok: true, facture: f.name, nc: ncs.map(n => n.name), adelier: lettres.map(m => m.name), montant: reste, _f: f, _nc: ncs, _delier: lettres.length ? [lf.id] : [] }
}

/** Exécute : délier, basculer la ligne d'attente du virement en créance du client, lettrer facture + NC + paiement. */
export async function lettrerCommission(bankLineId: number, plan: Awaited<ReturnType<typeof planCommission>>): Promise<string> {
  if (!plan.ok || !plan._f) throw new Error(plan.raison || 'plan invalide')
  const [line]: any[] = await odooRpc('account.bank.statement.line', 'read', [[bankLineId]], { fields: ['move_id'] })
  const bankMoveId = Number(line?.move_id?.[0])
  const susp: any[] = await odooRpc('account.move.line', 'search_read', [[['move_id', '=', bankMoveId], ['account_id', '=', SUSPENSE]]], { fields: ['id', 'credit'] })
  if (susp.length !== 1 || Math.abs(Number(susp[0].credit) - Number(plan.montant)) > 0.01) throw new Error('La ligne d\'attente du virement a changé : rien n\'est fait')
  for (const id of plan._delier || []) await odooRpc('account.move.line', 'remove_move_reconcile', [[id]])
  await odooRpc('account.move', 'button_draft', [[bankMoveId]])
  try { await odooRpc('account.move', 'write', [[bankMoveId], { line_ids: [[1, susp[0].id, { account_id: RECEIVABLE, partner_id: plan._f.commercial_partner_id[0], name: `${plan.facture} — NC ${plan.nc!.join(', ')}` }]] }]) }
  finally { await odooRpc('account.move', 'action_post', [[bankMoveId]]) }
  const lb: any[] = await odooRpc('account.move.line', 'search_read', [[['move_id', '=', bankMoveId], ['account_id', '=', RECEIVABLE], ['reconciled', '=', false]]], { fields: ['id'] })
  const lf = await ligneCreance(plan._f.id)
  const lnc = await Promise.all((plan._nc || []).map(n => ligneCreance(n.id)))
  await odooRpc('account.move.line', 'reconcile', [[lf.id, ...lnc.map(l => l.id), ...lb.map(l => l.id)]])
  return `${plan._f.commercial_partner_id[1]} ${Number(plan.montant).toFixed(2)} € : ${plan.facture} lettrée avec ${plan.nc!.join(', ')}${plan.adelier!.length ? ` (déliée(s) d'abord : ${plan.adelier!.join(', ')})` : ''}`
}
