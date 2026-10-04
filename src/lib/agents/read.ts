// src/lib/agents/read.ts
//
// Lectures des agents (lot 1) : toujours pour UNE société, vérifiée contre les
// droits de l'agent avant l'appel. L'ERP est interrogé avec odooRpcCompany :
// odooRpc verrouille la société 1 (cf. bug Riga du 04/10/2026).
// Les fiches, états de frais et dossiers Domaine sont de la société 1 (A9).

import { createAdminClient } from '@/lib/supabase'
import { odooRpcCompany } from '@/lib/odoo'

export const READS = ['fiche', 'factures_clients', 'factures_achat', 'banque', 'etats_de_frais', 'domaine'] as const
export type ReadKind = typeof READS[number]
export const READ_LABEL: Record<ReadKind, string> = {
  fiche:            'Fiche de mission (numéro ou plaque)',
  factures_clients: 'Factures clients',
  factures_achat:   'Factures d’achat',
  banque:           'Lignes de banque non rapprochées',
  etats_de_frais:   'États de frais (Parquet)',
  domaine:          'Dossiers Domaine (dates IN, ventes d’épaves)',
}
/** Lectures qui n'existent que pour Verviers Dépannage. */
export const VD_ONLY: ReadKind[] = ['fiche', 'etats_de_frais', 'domaine']

const LIMIT = 50
const clean = (s: string | null, max = 60) => (s || '').trim().slice(0, max)

export async function runRead(kind: ReadKind, company: number, q: URLSearchParams): Promise<any> {
  const sb = createAdminClient()
  if (VD_ONLY.includes(kind) && company !== 1) throw new Error('Cette lecture n’existe que pour Verviers Dépannage (societe=1).')

  if (kind === 'fiche') {
    const numero = clean(q.get('numero'), 20), plaque = clean(q.get('plaque'), 15).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    if (!numero && !plaque) throw new Error('Paramètre numero ou plaque obligatoire.')
    let req = sb.from('incoming_missions').select('id, mission_number, dossier_number, source, status, mission_type, incident_type, vehicle_plate, vehicle_brand, vehicle_model, client_name, billed_to_name, incident_address, destination_address, assigned_to, accepted_at, completed_at, created_at, amount_collected, payment_method, invoice_number, invoice_odoo_id, payment_state_odoo, parked_at, parc_exit_at, parc_exit_reason, remarks_general, remarks_billing').order('id', { ascending: false }).limit(10)
    req = numero ? req.eq('mission_number', numero) : req.ilike('vehicle_plate', `%${plaque}%`)
    const { data, error } = await req
    if (error) throw new Error(error.message)
    return data
  }

  if (kind === 'factures_clients' || kind === 'factures_achat') {
    const types = kind === 'factures_clients' ? ['out_invoice', 'out_refund'] : ['in_invoice', 'in_refund']
    const dom: any[] = [['move_type', 'in', types], ['company_id', '=', company]]
    const nom = clean(q.get('nom')), partenaire = clean(q.get('partenaire')), etat = clean(q.get('etat'), 10)
    if (nom) dom.push('|', ['name', 'ilike', nom], ['ref', 'ilike', nom])
    if (partenaire) dom.push(['partner_id', 'ilike', partenaire])
    if (['draft', 'posted', 'cancel'].includes(etat)) dom.push(['state', '=', etat])
    if (q.get('impayees') === '1') dom.push(['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']])
    return odooRpcCompany(company, 'account.move', 'search_read', [dom], {
      fields: ['id', 'name', 'ref', 'move_type', 'state', 'payment_state', 'partner_id', 'invoice_date', 'invoice_date_due', 'amount_untaxed', 'amount_total', 'amount_residual', 'journal_id', 'invoice_origin'],
      limit: LIMIT, order: 'invoice_date desc, id desc',
    })
  }

  if (kind === 'banque') {
    return odooRpcCompany(company, 'account.bank.statement.line', 'search_read', [[['company_id', '=', company], ['is_reconciled', '=', false]]], {
      fields: ['id', 'date', 'payment_ref', 'partner_id', 'amount', 'journal_id', 'account_number'],
      limit: 100, order: 'date desc, id desc',
    })
  }

  if (kind === 'etats_de_frais') {
    const ref = clean(q.get('numero'), 30)
    let req = sb.from('saisie_dossiers').select('*').order('id', { ascending: false }).limit(LIMIT)
    if (ref) req = req.or(`ef_number.ilike.%${ref.replace(/[,()]/g, '')}%,vehicle_plate.ilike.%${ref.replace(/[,()]/g, '')}%`)
    if (q.get('etat')) req = req.eq('state', clean(q.get('etat'), 30))
    const { data, error } = await req
    if (error) throw new Error(error.message)
    return data
  }

  // domaine
  const [ins, ventes] = await Promise.all([
    sb.from('domaine_dates_in').select('*').order('id', { ascending: false }).limit(LIMIT),
    sb.from('domaine_ventes_epaves').select('*').order('id', { ascending: false }).limit(LIMIT),
  ])
  if (ins.error) throw new Error(ins.error.message)
  if (ventes.error) throw new Error(ventes.error.message)
  return { dates_in: ins.data, ventes_epaves: ventes.data }
}
