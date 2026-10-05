// src/lib/agents/bank-match.ts
//
// Lot 2 de Florent (Olivier 05/10/2026) : rapprocher UNE ligne de banque en la
// ventilant, comme on le fait à la main (factures, écritures ouvertes, comptes).
// Validée par Olivier au début, puis faite seule quand il le dira.
//
// Une part, au signe de la ligne de banque (négatif = sortie d'argent) :
//   { facture_id, montant? }            facture client ou fournisseur ouverte ;
//                                       sans montant = son reste dû entier
//   { ecriture_ligne_id, montant? }     une ligne d'écriture ouverte (acompte,
//                                       paiement en suspens, avance…)
//   { compte, montant, libelle, partenaire_id?, tva21? }
//                                       un compte (code), sans lettrage ; tva21 :
//                                       le montant est TVAC, la TVA déductible
//                                       à 21 % est ventilée comme dans l'ERP
// La somme des parts doit être égale à la ligne. Rien n'est écrit au dépôt.

import { odooRpcCompany } from '@/lib/odoo'
import { getBusinessNumber } from '@/lib/settings/business'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface BankPart { amount: number; accountId: number; partnerId: number | false; label: string; match: number[]; tax?: 'base' | 'tax'; taxId?: number; tags?: number[]; repLine?: number }

async function bankLine(company: number, id: number) {
  const [l]: any[] = await odooRpcCompany(company, 'account.bank.statement.line', 'read', [[id]], { fields: ['id', 'date', 'amount', 'payment_ref', 'partner_id', 'is_reconciled', 'company_id', 'journal_id', 'move_id'] })
  if (!l || l.company_id?.[0] !== company) throw new Error(`Ligne de banque ${id} introuvable dans cette société.`)
  if (l.is_reconciled) throw new Error(`Ligne de banque ${id} déjà rapprochée.`)
  return l
}

/** TVA déductible 21 % : taxe, étiquettes et ligne de répartition, lues dans l'ERP. */
async function tax21(company: number) {
  const taxId = await getBusinessNumber('odoo_taxe_achat_21')
  const reps: any[] = await odooRpcCompany(company, 'account.tax.repartition.line', 'search_read', [[['tax_id', '=', taxId], ['document_type', '=', 'invoice']]], { fields: ['id', 'repartition_type', 'account_id', 'tag_ids'] })
  const base = reps.find(r => r.repartition_type === 'base'), tax = reps.find(r => r.repartition_type === 'tax' && r.account_id)
  if (!base || !tax) throw new Error('TVA 21 % : répartition introuvable dans l’ERP.')
  return { taxId, baseTags: base.tag_ids as number[], taxTags: tax.tag_ids as number[], taxAccount: tax.account_id[0] as number, repLine: tax.id as number }
}

/** Contrôle et traduit les parts proposées. Renvoie aussi un résumé lisible. */
export async function resolveBankParts(company: number, lineId: number, raw: any[]): Promise<{ line: any; parts: BankPart[]; resume: string[] }> {
  const line = await bankLine(company, lineId)
  if (!Array.isArray(raw) || !raw.length || raw.length > 40) throw new Error('contenu.parts : 1 à 40 parts.')
  const parts: BankPart[] = [], resume: string[] = []
  for (const [i, p] of raw.entries()) {
    const label0 = String(p?.libelle || '').trim().slice(0, 120)
    if (p?.facture_id) {
      const id = Number(p.facture_id)
      const [m]: any[] = await odooRpcCompany(company, 'account.move', 'read', [[id]], { fields: ['id', 'name', 'state', 'company_id', 'commercial_partner_id'] })
      if (!m || m.company_id?.[0] !== company || m.state !== 'posted') throw new Error(`Part ${i + 1} : pièce ${id} introuvable ou non validée.`)
      const open: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', id], ['account_id.account_type', 'in', ['asset_receivable', 'liability_payable']], ['reconciled', '=', false]]], { fields: ['id', 'account_id', 'amount_residual'] })
      if (open.length !== 1) throw new Error(`Part ${i + 1} : ${m.name} est déjà soldée (ou a plusieurs échéances).`)
      const due = r2(open[0].amount_residual)
      const amount = p.montant == null ? due : r2(Number(p.montant))
      if (Math.sign(amount) !== Math.sign(due) || Math.abs(amount) > Math.abs(due) + 0.005) throw new Error(`Part ${i + 1} : ${amount} € pour ${m.name} (reste dû ${due} €).`)
      parts.push({ amount, accountId: open[0].account_id[0], partnerId: m.commercial_partner_id?.[0] || false, label: `${m.name} — ${m.commercial_partner_id?.[1] || ''}`.slice(0, 120), match: [open[0].id] })
      resume.push(`${m.name} · ${amount.toFixed(2)} €${Math.abs(amount) < Math.abs(due) ? ` (partiel, reste ${(due - amount).toFixed(2)} €)` : ''}`)
    } else if (p?.ecriture_ligne_id) {
      const id = Number(p.ecriture_ligne_id)
      const [l]: any[] = await odooRpcCompany(company, 'account.move.line', 'read', [[id]], { fields: ['id', 'move_id', 'account_id', 'partner_id', 'amount_residual', 'reconciled', 'company_id', 'parent_state'] })
      if (!l || l.company_id?.[0] !== company || l.parent_state !== 'posted' || l.reconciled) throw new Error(`Part ${i + 1} : ligne d’écriture ${id} introuvable ou déjà lettrée.`)
      const due = r2(l.amount_residual)
      const amount = p.montant == null ? due : r2(Number(p.montant))
      if (Math.sign(amount) !== Math.sign(due) || Math.abs(amount) > Math.abs(due) + 0.005) throw new Error(`Part ${i + 1} : ${amount} € pour ${l.move_id[1]} (ouvert ${due} €).`)
      parts.push({ amount, accountId: l.account_id[0], partnerId: l.partner_id?.[0] || false, label: (label0 || `${l.move_id[1]}`).slice(0, 120), match: [l.id] })
      resume.push(`${l.move_id[1]} (${l.account_id[1]}) · ${amount.toFixed(2)} €`)
    } else if (p?.compte) {
      const acc: any[] = await odooRpcCompany(company, 'account.account', 'search_read', [[['code', '=', String(p.compte)]]], { fields: ['id', 'code', 'name'], limit: 2 })
      if (acc.length !== 1) throw new Error(`Part ${i + 1} : compte ${p.compte} introuvable.`)
      if (!label0) throw new Error(`Part ${i + 1} : libelle obligatoire pour un compte.`)
      const amount = r2(Number(p.montant))
      if (!amount) throw new Error(`Part ${i + 1} : montant obligatoire pour un compte.`)
      const partnerId = p.partenaire_id ? Number(p.partenaire_id) : false
      if (p.tva21) {
        const t = await tax21(company)
        const base = r2(amount / 1.21), vat = r2(amount - base)
        parts.push({ amount: base, accountId: acc[0].id, partnerId, label: label0, match: [], tax: 'base', taxId: t.taxId, tags: t.baseTags })
        parts.push({ amount: vat, accountId: t.taxAccount, partnerId, label: `TVA 21 % — ${label0}`.slice(0, 120), match: [], tax: 'tax', tags: t.taxTags, repLine: t.repLine })
        resume.push(`${acc[0].code} ${acc[0].name} · ${base.toFixed(2)} € + TVA ${vat.toFixed(2)} € (${label0})`)
      } else {
        parts.push({ amount, accountId: acc[0].id, partnerId, label: label0, match: [] })
        resume.push(`${acc[0].code} ${acc[0].name} · ${amount.toFixed(2)} € (${label0})`)
      }
    } else throw new Error(`Part ${i + 1} : facture_id, ecriture_ligne_id ou compte attendu.`)
  }
  const sum = r2(parts.reduce((s, x) => s + x.amount, 0))
  if (Math.abs(sum - r2(line.amount)) > 0.005) throw new Error(`Les parts font ${sum.toFixed(2)} € pour une ligne de ${Number(line.amount).toFixed(2)} €.`)
  const labels = parts.map(x => x.label)
  if (new Set(labels).size !== labels.length) throw new Error('Deux parts ont le même libellé : rendez-les distincts.')
  return { line, parts, resume }
}

/** Remplace la ligne d'attente par les parts, revalide, puis lettre part par part. */
export async function postBankParts(company: number, lineId: number, parts: BankPart[]): Promise<void> {
  const line = await bankLine(company, lineId)
  const [journal]: any[] = await odooRpcCompany(company, 'account.journal', 'read', [[line.journal_id[0]]], { fields: ['suspense_account_id'] })
  const moveId = line.move_id[0]
  const sus: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', moveId], ['account_id', '=', journal?.suspense_account_id?.[0]]]], { fields: ['id'], limit: 2 })
  if (sus.length !== 1) throw new Error('La contrepartie de cette ligne n’est plus en compte d’attente : déjà touchée.')
  const cmd = (x: BankPart) => ({
    account_id: x.accountId, partner_id: x.partnerId, name: x.label, debit: x.amount < 0 ? -x.amount : 0, credit: x.amount > 0 ? x.amount : 0, amount_currency: -x.amount,
    ...(x.tax === 'base' ? { tax_ids: [[6, 0, [x.taxId]]], tax_tag_ids: [[6, 0, x.tags || []]] } : {}),
    ...(x.tax === 'tax' ? { tax_tag_ids: [[6, 0, x.tags || []]], tax_repartition_line_id: x.repLine } : {}),
  })
  await odooRpcCompany(company, 'account.move', 'button_draft', [[moveId]])
  try {
    await odooRpcCompany(company, 'account.move', 'write', [[moveId], { line_ids: [[1, sus[0].id, cmd(parts[0])], ...parts.slice(1).map(x => [0, 0, cmd(x)])] }])
  } finally {
    await odooRpcCompany(company, 'account.move', 'action_post', [[moveId]])
  }
  const fresh: any[] = await odooRpcCompany(company, 'account.move.line', 'search_read', [[['move_id', '=', moveId]]], { fields: ['id', 'name'], order: 'id' })
  for (const x of parts) {
    if (!x.match.length) continue
    const l = fresh.find(f => f.name === x.label)
    if (!l) throw new Error(`Ligne « ${x.label} » introuvable après ventilation.`)
    await odooRpcCompany(company, 'account.move.line', 'reconcile', [[l.id, ...x.match]])
  }
  const after = await odooRpcCompany<any[]>(company, 'account.bank.statement.line', 'read', [[lineId]], { fields: ['is_reconciled'] })
  if (!after?.[0]?.is_reconciled) throw new Error('Ventilation écrite, mais la ligne ne se marque pas rapprochée : à vérifier dans l’ERP.')
}
