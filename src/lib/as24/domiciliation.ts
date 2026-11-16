// src/lib/as24/domiciliation.ts
//
// Prélèvements AS 24 (Olivier 12/11/2026 : « tu corriges et tu adaptes le process »).
//
// Chaque prélèvement AS 24 paie UN relevé-facture de l'espace client (AS 24 Belgium ou
// AS 24 Nederland). Le relevé regroupe des factures (« PFA ») et une note de débit
// (« PND ») qui contient elle-même la facture Viapass (« SFC »), les décomptes de taxe
// kilométrique (« FLN » Flandre, « BRS » Bruxelles) et les péages étrangers.
// Les agents n'encodent que les factures annoncées par mail (SFC, PFA) : le reste du
// relevé n'existait nulle part, et les factures étaient marquées payées par un paiement
// fictif jamais relié à la banque (« payé sans mouvement banque = pas payé »).
//
// Ici, pour une ligne de banque AS 24 :
//   1. on retrouve le relevé dont le total = le montant prélevé ;
//   2. on reprend les pièces déjà encodées (par leur numéro), on annule leurs paiements
//      fictifs et on remet au bon fournisseur une pièce encodée sur l'autre compte ;
//   3. on encode une pièce « complément du relevé » pour ce qui manque, PDF joints ;
//   4. on rapproche le prélèvement avec toutes les pièces du relevé.
// Tout écart (relevé introuvable, pièces encodées en trop) arrête sans rien écrire.

import { odooRpc } from '@/lib/odoo'
import { getBusinessList } from '@/lib/settings/business'
import { listAs24Documents, downloadAs24Pdf, type As24Compte, type As24Document } from '@/lib/as24/extranet'
import { resolveBankParts, postBankParts } from '@/lib/agents/bank-match'

const r2 = (n: number) => Math.round(n * 100) / 100
const VD = 1

export interface As24Rapprochement { ligne: number; compte: As24Compte; releve: string; pieces: string[]; complement: string | null; paiementsAnnules: number; note: string }

/** Composition d'un relevé : les pièces de même date qui le totalisent (factures et notes de débit hors Viapass). */
function composition(docs: As24Document[], releve: As24Document): As24Document[] {
  return docs.filter(d => d.date === releve.date && d.numero !== releve.numero
    && !/relev/i.test(d.type) && !/VIAPASS/i.test(d.type) && d.tvac != null)
}

async function partenaires(): Promise<{ be: number; nl: number; tous: number[] }> {
  const ids = (await getBusinessList('odoo_partners_as24')).map(Number).filter(Boolean)
  if (ids.length < 2) throw new Error('Réglage odoo_partners_as24 : il faut AS 24 Belgium puis AS 24 Nederland.')
  return { be: ids[0], nl: ids[1], tous: ids }
}

/** Annule les paiements d'une facture qui ne sont reliés à aucun mouvement de banque. */
async function annulerPaiementsFictifs(billId: number): Promise<number> {
  const [b] = await odooRpc<any[]>('account.move', 'read', [[billId]], { fields: ['invoice_payments_widget'] })
  let n = 0
  for (const p of b?.invoice_payments_widget?.content || []) {
    if (!p.account_payment_id) continue
    const [pay] = await odooRpc<any[]>('account.payment', 'read', [[p.account_payment_id]], { fields: ['state', 'is_matched'] })
    if (!pay || pay.is_matched || pay.state === 'canceled') continue
    await odooRpc('account.payment', 'action_draft', [[p.account_payment_id]])
    await odooRpc('account.payment', 'action_cancel', [[p.account_payment_id]])
    n++
  }
  return n
}

export async function rapprocherDomiciliationAs24(lineId: number, opts: { simulation?: boolean } = {}): Promise<As24Rapprochement> {
  const [line] = await odooRpc<any[]>('account.bank.statement.line', 'read', [[lineId]], { fields: ['date', 'amount', 'payment_ref', 'is_reconciled', 'move_id'] })
  if (!line || line.amount >= 0) throw new Error(`Ligne ${lineId} : pas un prélèvement.`)
  const compte: As24Compte = /NEDERLAND/i.test(String(line.payment_ref)) ? 'nl' : 'be'
  const p = await partenaires()
  const partner = compte === 'nl' ? p.nl : p.be
  const montant = r2(-line.amount)

  // Ligne déjà sortie du compte d'attente vers le compte fournisseur (octobre) : on lettrera ce débit.
  let debitFournisseur: number | null = null
  if (line.is_reconciled) {
    const d = await odooRpc<any[]>('account.move.line', 'search_read', [[['move_id', '=', line.move_id[0]], ['account_id.account_type', '=', 'liability_payable'], ['reconciled', '=', false], ['debit', '>', 0]]], { fields: ['id', 'amount_residual'] })
    if (d.length !== 1 || Math.abs(r2(d[0].amount_residual) - montant) > 0.005) throw new Error(`Ligne ${lineId} : déjà rapprochée.`)
    debitFournisseur = d[0].id
  }

  // 1. Le relevé prélevé.
  const fin = new Date(`${line.date}T23:59:59Z`)
  const docs = await listAs24Documents(new Date(fin.getTime() - 40 * 86_400_000), fin, compte)
  const releves = docs.filter(d => /relev.*factur/i.test(d.type) && d.tvac != null && Math.abs(r2(d.tvac) - montant) < 0.005)
  if (releves.length !== 1) throw new Error(`AS 24 ${compte.toUpperCase()} : ${releves.length ? 'plusieurs relevés' : 'aucun relevé'} de ${montant.toFixed(2)} € avant le ${line.date}.`)
  const releve = releves[0]
  const parts = composition(docs, releve)
  const somme = r2(parts.reduce((s, d) => s + Number(d.tvac), 0))
  if (Math.abs(somme - montant) > 0.005) throw new Error(`Relevé ${releve.numero} : ses pièces font ${somme.toFixed(2)} € pour ${montant.toFixed(2)} € prélevés.`)

  // 2. Pièces déjà encodées (par numéro, sur l'un ou l'autre compte AS 24).
  const numeros = docs.filter(d => d.date === releve.date).map(d => d.numero)
  const encodees = await odooRpc<any[]>('account.move', 'search_read', [[['move_type', 'in', ['in_invoice', 'in_refund']], ['state', '=', 'posted'], ['partner_id', 'in', p.tous], ['ref', 'in', [...numeros, releve.numero]]]], { fields: ['id', 'name', 'ref', 'partner_id', 'amount_total', 'move_type'] })
  const dejaComplement = encodees.find(e => e.ref === releve.numero)
  const total = r2(encodees.reduce((s, e) => s + (e.move_type === 'in_refund' ? -1 : 1) * Number(e.amount_total), 0))
  const reste = r2(montant - total)
  if (reste < -0.005) throw new Error(`Relevé ${releve.numero} : ${total.toFixed(2)} € déjà encodés pour ${montant.toFixed(2)} € prélevés (doublon ?).`)

  if (opts.simulation) {
    const malPlacees = encodees.filter(e => e.partner_id?.[0] !== partner).map(e => e.name)
    return { ligne: lineId, compte, releve: releve.numero, pieces: encodees.map(e => e.name), complement: reste > 0.005 && !dejaComplement ? `à créer : ${reste.toFixed(2)} €` : null, paiementsAnnules: 0,
      note: `SIMULATION · ${line.date} ${montant.toFixed(2)} € = relevé ${releve.numero} (${parts.map(d => `${d.numero} ${d.tvac}`).join(' + ')}) · encodé : ${encodees.map(e => `${e.name} ${e.ref} ${e.amount_total}`).join(', ') || 'rien'} · reste ${reste.toFixed(2)} €${malPlacees.length ? ` · à remettre sur AS 24 ${compte.toUpperCase()} : ${malPlacees.join(', ')}` : ''}${debitFournisseur ? ' · déjà sur le compte fournisseur' : ''}` }
  }

  let paiementsAnnules = 0
  for (const e of encodees) {
    paiementsAnnules += await annulerPaiementsFictifs(e.id)
    if (e.partner_id?.[0] !== partner) {
      await odooRpc('account.move', 'button_draft', [[e.id]])
      await odooRpc('account.move', 'write', [[e.id], { partner_id: partner }])
      await odooRpc('account.move', 'action_post', [[e.id]])
      const [chk] = await odooRpc<any[]>('account.move', 'read', [[e.id]], { fields: ['amount_total'] })
      if (Math.abs(Number(chk.amount_total) - Number(e.amount_total)) > 0.005) throw new Error(`${e.name} : le montant change en passant sur AS 24 ${compte.toUpperCase()}, à vérifier.`)
    }
  }

  // 3. Complément du relevé : ce que les pièces encodées ne couvrent pas.
  let complement: any = null
  if (reste > 0.005 && !dejaComplement) {
    const modele = await odooRpc<any[]>('account.move.line', 'search_read', [[['move_id', 'in', encodees.map(e => e.id)], ['display_type', '=', 'product']]], { fields: ['account_id'], limit: 1 })
    const compteCharge = modele[0]?.account_id?.[0]
    if (!compteCharge) throw new Error(`Relevé ${releve.numero} : aucune pièce encodée pour reprendre le compte de charge.`)
    let taxes: number[] = []
    if (compte === 'nl') {
      const t = await odooRpc<any[]>('account.tax', 'search_read', [[['type_tax_use', '=', 'purchase'], ['name', '=', '0% EU S']]], { fields: ['id'], limit: 1 })
      taxes = t.length ? [t[0].id] : []
    }
    const manquants = parts.filter(d => !encodees.some(e => e.ref === d.numero)).map(d => d.numero)
    const id = await odooRpc<number>('account.move', 'create', [{
      move_type: 'in_invoice', partner_id: partner, invoice_date: releve.date, ref: releve.numero,
      invoice_line_ids: [[0, 0, {
        name: `AS 24 — complément du relevé ${releve.numero} (taxes kilométriques, péages étrangers, frais) : ${manquants.join(', ')}`.slice(0, 250),
        account_id: compteCharge, quantity: 1, price_unit: reste, tax_ids: [[6, 0, taxes]],
      }]],
    }])
    const [chk] = await odooRpc<any[]>('account.move', 'read', [[id]], { fields: ['amount_total'] })
    if (Math.abs(Number(chk.amount_total) - reste) > 0.005) {
      await odooRpc('account.move', 'unlink', [[id]]).catch(() => {})
      throw new Error(`Relevé ${releve.numero} : le complément ferait ${chk.amount_total} € au lieu de ${reste.toFixed(2)} €.`)
    }
    for (const d of docs.filter(x => x.date === releve.date)) {
      const pdf = await downloadAs24Pdf(d).catch(() => null)
      if (pdf) await odooRpc('ir.attachment', 'create', [{ name: `${d.numero}.pdf`, res_model: 'account.move', res_id: id, type: 'binary', datas: pdf.toString('base64'), mimetype: 'application/pdf' }])
    }
    await odooRpc('account.move', 'action_post', [[id]])
    ;[complement] = await odooRpc<any[]>('account.move', 'read', [[id]], { fields: ['id', 'name'] })
  }

  // 4. Rapprochement.
  const pieces = [...encodees, ...(complement ? [complement] : [])]
  if (debitFournisseur) {
    const credits = await odooRpc<any[]>('account.move.line', 'search_read', [[['move_id', 'in', pieces.map((x: any) => x.id)], ['account_id.account_type', '=', 'liability_payable'], ['reconciled', '=', false]]], { fields: ['id'] })
    await odooRpc('account.move.line', 'reconcile', [[debitFournisseur, ...credits.map(c => c.id)]])
  } else {
    const { parts: bp } = await resolveBankParts(VD, lineId, pieces.map((x: any) => ({ facture_id: x.id })))
    await postBankParts(VD, lineId, bp)
  }
  const noms = pieces.map((x: any) => x.name)
  return {
    ligne: lineId, compte, releve: releve.numero, pieces: noms, complement: complement?.name || null, paiementsAnnules,
    note: `Prélèvement AS 24 ${compte.toUpperCase()} du ${line.date} (${montant.toFixed(2)} €) = relevé ${releve.numero} : ${noms.join(', ')}${complement ? ` (complément ${complement.name} : ${reste.toFixed(2)} €)` : ''}${paiementsAnnules ? ` · ${paiementsAnnules} paiement(s) fictif(s) annulé(s)` : ''}`,
  }
}

/** Prélèvements AS 24 encore ouverts (en attente, ou posés sur le compte fournisseur sans lettrage). */
export async function prelevementsAs24Ouverts(depuis = '2026-10-01'): Promise<number[]> {
  const lignes = await odooRpc<any[]>('account.bank.statement.line', 'search_read', [[['date', '>=', depuis], ['amount', '<', 0], '|', ['payment_ref', 'ilike', 'AS24'], ['payment_ref', 'ilike', 'AS 24']]], { fields: ['id', 'is_reconciled', 'move_id'] })
  const out: number[] = []
  for (const l of lignes) {
    if (!l.is_reconciled) { out.push(l.id); continue }
    const d = await odooRpc<any[]>('account.move.line', 'search_read', [[['move_id', '=', l.move_id[0]], ['account_id.account_type', '=', 'liability_payable'], ['reconciled', '=', false], ['debit', '>', 0]]], { fields: ['id'], limit: 1 })
    if (d.length) out.push(l.id)
  }
  return out
}
