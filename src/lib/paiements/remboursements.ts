// src/lib/paiements/remboursements.ts — remboursements clients dans les paiements (Olivier 22/10/2026, maquette validée).
//
// Deux sources au tri d'Olivier :
//   1. les notes de crédit ouvertes des clients PARTICULIERS (celles des assistances et des garages se déduisent de
//      leurs paiements) : elles passent par la liste d'attente comme une facture (voir ajouter() de fournisseurs.ts),
//      sur le compte de la fiche client ;
//   2. les DOUBLES PAIEMENTS reçus (table remboursements_clients) : rembourser sur le compte qui a payé, ou compenser.
//      Rembourser = le trop-perçu est d'abord porté sur le compte du client s'il est encore une ligne de banque en
//      attente, puis la ligne de trop-perçu entre dans la liste d'attente ; au lot, le virement est créé dessus et la
//      relie : le double paiement est soldé.
import { createAdminClient } from '@/lib/supabase'
import { odooRpcCompany } from '@/lib/odoo'

export type DoublePaiement = {
  id: string; partner_id: number; partner_name: string; amount: number; recu_le: string | null; facture: string | null
  motif: string | null; iban: string | null; options: string[]; statut: string; choix: string | null; note: string | null
}

const normIban = (s: string | null | undefined) => String(s || '').replace(/\s+/g, '').toUpperCase()

export async function doublesATrier(C: number): Promise<DoublePaiement[]> {
  const { data, error } = await createAdminClient().from('remboursements_clients').select('*')
    .eq('company_id', C).in('statut', ['a_trier', 'compte_a_demander', 'a_compenser']).order('recu_le', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map((r: any) => ({ ...r, amount: Number(r.amount), options: r.options || [] }))
}

/** Notes de crédit ouvertes de clients particuliers (pas une société), pas encore dans la liste d'attente. */
export async function ncParticuliersIds(C: number): Promise<number[]> {
  const ncs: any[] = await odooRpcCompany(C, 'account.move', 'search_read', [[['move_type', '=', 'out_refund'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']], ['commercial_partner_id.is_company', '=', false], ['invoice_date', '>=', '2026-01-01']]], { fields: ['id'], limit: 200 })
  const { data: q } = await createAdminClient().from('paiements_attente').select('move_id').eq('company_id', C).eq('statut', 'attente')
  const deja = new Set((q || []).map((r: any) => r.move_id))
  return ncs.map(n => n.id).filter(id => !deja.has(id))
}

/** Compte bancaire du client pour le virement : celui qui a payé (ou saisi), créé sur sa fiche s'il n'y est pas. */
async function compteClient(C: number, partnerId: number, iban: string): Promise<number> {
  const acc = normIban(iban)
  const all: any[] = await odooRpcCompany(C, 'res.partner.bank', 'search_read', [[['partner_id', '=', partnerId]]], { fields: ['id', 'acc_number', 'allow_out_payment'] })
  const found = all.find(b => normIban(b.acc_number) === acc)
  if (found) {
    if (!found.allow_out_payment) await odooRpcCompany(C, 'res.partner.bank', 'write', [[found.id], { allow_out_payment: true }])
    return found.id
  }
  // Créé et autorisé : c'est Olivier qui l'a choisi au tri (le compte d'où l'argent est venu).
  return await odooRpcCompany<number>(C, 'res.partner.bank', 'create', [{ partner_id: partnerId, acc_number: acc, allow_out_payment: true }])
}

/** Ligne de trop-perçu (créance négative) du client sur l'écriture de la ligne de banque ; la crée si la ligne est
 *  encore en compte d'attente. */
async function ligneTropPercu(C: number, r: DoublePaiement & { bank_line_id: number }): Promise<{ amlId: number; moveId: number; residual: number }> {
  const [line]: any[] = await odooRpcCompany(C, 'account.bank.statement.line', 'read', [[r.bank_line_id]], { fields: ['id', 'move_id', 'amount', 'is_reconciled', 'partner_id'] })
  if (!line) throw new Error('Ligne de banque introuvable')
  const chercher = async () => (await odooRpcCompany<any[]>(C, 'account.move.line', 'search_read', [[['move_id', '=', line.move_id[0]], ['account_id.account_type', '=', 'asset_receivable'], ['partner_id', '=', r.partner_id], ['reconciled', '=', false], ['amount_residual', '<', 0]]], { fields: ['id', 'amount_residual'] }))
  let cr = await chercher()
  if (!cr.length && !line.is_reconciled) {
    // Encore en compte d'attente : on porte le montant reçu sur le compte client (créance négative = trop-perçu).
    const [p]: any[] = await odooRpcCompany(C, 'res.partner', 'read', [[r.partner_id]], { fields: ['property_account_receivable_id'] })
    const accountId = p?.property_account_receivable_id?.[0]
    if (!accountId) throw new Error(`Compte client introuvable pour ${r.partner_name}`)
    const { postBankParts } = await import('@/lib/agents/bank-match')
    await postBankParts(C, r.bank_line_id, [{ amount: Number(line.amount), accountId, partnerId: r.partner_id, label: `Double paiement ${r.facture || ''} — à rembourser`.slice(0, 120), match: [] }])
    cr = await chercher()
  }
  const best = cr.find(c => Math.abs(Math.abs(c.amount_residual) - r.amount) < 0.01) || cr[0]
  if (!best) throw new Error(`Trop-perçu de ${r.partner_name} introuvable sur la ligne de banque (déjà lettré ?)`)
  return { amlId: best.id, moveId: line.move_id[0], residual: Math.abs(best.amount_residual) }
}

/**
 * Olivier décide au tri : rembourser (virement dans le lot), compenser (pas de virement), ou, pour SOS, rembourser
 * la personne qui a payé sur place (compte à saisir).
 */
export async function deciderDouble(C: number, id: string, choix: 'rembourser' | 'compenser' | 'personne', ibanSaisi: string | null, userId: string | null): Promise<string> {
  const sb = createAdminClient()
  const { data: r } = await sb.from('remboursements_clients').select('*').eq('id', id).eq('company_id', C).maybeSingle()
  if (!r) throw new Error('Remboursement introuvable')
  if (r.statut === 'attente' || r.statut === 'pris') throw new Error('Déjà dans la liste d’attente')
  const now = new Date().toISOString()
  if (choix === 'compenser') {
    await sb.from('remboursements_clients').update({ choix, statut: 'a_compenser', note: 'Compensation sur les factures ouvertes du client, sans virement', updated_at: now }).eq('id', id)
    return 'compensation'
  }
  const iban = normIban(choix === 'personne' ? ibanSaisi : (ibanSaisi || r.iban))
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) {
    await sb.from('remboursements_clients').update({ choix, statut: 'compte_a_demander', updated_at: now }).eq('id', id)
    return 'compte_a_demander'
  }
  const bankId = await compteClient(C, r.partner_id, iban)
  const tp = await ligneTropPercu(C, { ...r, amount: Number(r.amount), options: r.options || [] })
  const { data: att, error } = await sb.from('paiements_attente').insert({
    company_id: C, move_id: tp.moveId, move_name: `Remboursement double paiement`, partner_id: r.partner_id, partner_name: r.partner_name,
    ref: r.facture, amount: Math.min(Number(r.amount), tp.residual), communication: `Remboursement double paiement facture ${r.facture || ''}`.trim().slice(0, 140),
    ajoute_par: userId, aml_id: tp.amlId, remb_id: r.id,
  }).select('id').single()
  if (error) throw new Error(error.message)
  await sb.from('remboursements_clients').update({ choix, iban, statut: 'attente', attente_id: att.id, note: `Compte ${iban} (fiche client n° ${bankId})`, updated_at: now }).eq('id', id)
  return 'attente'
}
