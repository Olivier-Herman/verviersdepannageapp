// src/lib/paie/push-odoo.ts
//
// Push d'une fiche de paie vers Odoo (Verviers Depannage) sous forme de
// FACTURE FOURNISSEUR POSTÉE (net à payer) sur le chauffeur (res.partner via
// personnel.odoo_partner_id), dans le journal dédié « Fiches de paie ».
// Le PDF de la fiche est joint à la facture. `payslips.odoo_move_id` sert
// d'anti-doublon (jamais repoussé).
//
// Objectif = rapprochement bancaire auto : la facture crée un « à payer » sur
// le fournisseur-chauffeur → le virement de salaire se lettre tout seul (match
// partenaire + montant net). Le journal PAIE est exclu de Gestion Achat.
//
// Olivier 2026-08-01.

import { odooRpc } from '@/lib/odoo'
import { createAdminClient } from '@/lib/supabase'

// Journal dédié créé dans Odoo (Verviers Depannage, type Achats). Voir mémoire
// project_module_paie. Exclu de Gestion Achat (cf. odoo-spend + cron achats-parse).
export const PAIE_JOURNAL_ID = 45
// Compte de charge selon le STATUT de la personne (personnel.statut) :
//   ouvrier → 620300 (Hourly Employees) · employe → 620200 (Salaried) · gerant → 620000 (Directors).
// Défaut = ouvrier (la majorité). Aligne aussi le default_account_id du journal (620300).
export const PAIE_ACCOUNT_BY_STATUT: Record<string, number> = {
  ouvrier: 355,   // 620300 Remuneration of Hourly Employees
  employe: 354,   // 620200 Remuneration of Salaried Employees
  gerant:  352,   // 620000 Remuneration of Directors or Managers
}
export const PAIE_ACCOUNT_DEFAULT = 355   // ouvrier
export const accountForStatut = (statut?: string | null): number =>
  PAIE_ACCOUNT_BY_STATUT[(statut || '').toLowerCase()] ?? PAIE_ACCOUNT_DEFAULT

const TYPE_LABELS: Record<string, string> = {
  salaire: 'Salaire', prime: 'Prime', vacances: 'Pécule de vacances', conge: 'Congé', autre: 'Rémunération',
}

/** Dernier jour du mois d'une période 'YYYY-MM' → 'YYYY-MM-DD'. */
function endOfMonth(period: string): string {
  const [y, m] = (period || '').split('-').map(Number)
  if (!y || !m) return new Date().toISOString().slice(0, 10)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export interface PushResult { moveId: number; moveName: string; skipped?: boolean; reason?: string }

/**
 * Pousse une fiche de paie vers Odoo. Idempotent : si `odoo_move_id` est déjà
 * renseigné, ne fait rien (sauf `force`). Nécessite un montant net > 0 et un
 * `odoo_partner_id` sur la personne liée.
 */
export async function pushPayslipToOdoo(payslipId: string, opts: { force?: boolean } = {}): Promise<PushResult> {
  const sb = createAdminClient()

  const { data: slip } = await sb.from('payslips')
    .select('id, personnel_id, worker_name, period, type, label, montant_net, pdf_b64, odoo_move_id')
    .eq('id', payslipId).maybeSingle()
  if (!slip) throw new Error('Fiche introuvable')

  if (slip.odoo_move_id && !opts.force) {
    return { moveId: slip.odoo_move_id, moveName: '', skipped: true, reason: 'déjà poussée' }
  }
  if (slip.montant_net == null) throw new Error('Montant net absent (relancer « Re-traiter » pour extraire les montants)')
  const net = Number(slip.montant_net)
  if (net === 0) throw new Error('Montant net nul — rien à pousser')
  // Net négatif (correction de fiche) : Odoo 19 REFUSE de poster une facture à
  // total négatif → on crée une NOTE DE CRÉDIT fournisseur (in_refund) avec un
  // montant positif. Elle s'impute au même compte de charge et se lettre pareil.
  const isRefund = net < 0
  const amount   = Math.abs(net)

  if (!slip.personnel_id) throw new Error('Fiche non rattachée à une personne')
  const { data: person } = await sb.from('personnel')
    .select('id, name, odoo_partner_id, statut').eq('id', slip.personnel_id).maybeSingle()
  if (!person) throw new Error('Personne introuvable')
  if (!person.odoo_partner_id) throw new Error(`${person.name} : pas d'ID contact Odoo renseigné (fiche employé → « ID contact Odoo »)`)
  const accountId = accountForStatut(person.statut)

  const typeLabel = slip.label || TYPE_LABELS[slip.type] || 'Rémunération'
  const lineName  = `${typeLabel} ${slip.period}${isRefund ? ' (correction)' : ''} — ${slip.worker_name || person.name}`
  // ref = n° de « facture fournisseur » : unique par personne/période/type → anti-doublon Odoo aussi.
  const ref = `PAIE-${slip.period}-${person.id.slice(0, 8)}-${slip.type || 'x'}`
  const invoiceDate = endOfMonth(slip.period)

  // 1. Créer la pièce (brouillon) — facture (net > 0) ou note de crédit (net < 0)
  const moveId = await odooRpc<number>('account.move', 'create', [{
    move_type:    isRefund ? 'in_refund' : 'in_invoice',
    partner_id:   Number(person.odoo_partner_id),
    journal_id:   PAIE_JOURNAL_ID,
    invoice_date: invoiceDate,
    ref,
    invoice_line_ids: [[0, 0, {
      name:       lineName,
      quantity:   1,
      price_unit: amount,          // toujours positif ; le sens vient du move_type
      account_id: accountId,
      tax_ids:    [[6, 0, []]],   // pas de TVA sur les salaires
    }]],
  }])

  // 2. Poster
  await odooRpc('account.move', 'action_post', [[moveId]])

  // 3. Joindre le PDF de la fiche à la facture
  if (slip.pdf_b64) {
    try {
      const attId = await odooRpc<number>('ir.attachment', 'create', [{
        name:      `${typeLabel} ${slip.period} — ${(slip.worker_name || person.name)}.pdf`,
        type:      'binary',
        datas:     slip.pdf_b64,
        res_model: 'account.move',
        res_id:    moveId,
        mimetype:  'application/pdf',
      }])
      await odooRpc('account.move', 'message_post', [[moveId]], {
        body: `Fiche de paie — ${typeLabel} ${slip.period}`,
        message_type: 'comment', subtype_id: 2, attachment_ids: [[4, attId]],
      })
    } catch (e: any) { console.error('[paie push] attach PDF:', e.message) }
  }

  // 4. Lire le nom (INV/…) + enregistrer l'anti-doublon
  const [read] = await odooRpc<any[]>('account.move', 'read', [[moveId]], { fields: ['name'] })
  await sb.from('payslips').update({ odoo_move_id: moveId }).eq('id', slip.id)

  return { moveId, moveName: read?.name || `#${moveId}` }
}

/**
 * Garantit un contact Odoo (res.partner) pour une personne : si `odoo_partner_id`
 * est déjà là → ne fait rien. Sinon cherche un FOURNISSEUR existant au même nom
 * (le chauffeur est souvent déjà encodé comme fournisseur pour les salaires) ;
 * à défaut, CRÉE le contact (personne, marqué fournisseur) avec les infos VD Soft.
 * Écrit l'id trouvé/créé dans `personnel.odoo_partner_id`.
 */
export async function ensureOdooPartnerForPersonnel(personnelId: string): Promise<{ partnerId: number; created: boolean }> {
  const sb = createAdminClient()
  const { data: p } = await sb.from('personnel')
    .select('id, name, odoo_partner_id, adresse, code_postal, ville, phone, email').eq('id', personnelId).maybeSingle()
  if (!p) throw new Error('Personne introuvable')
  if (p.odoo_partner_id) return { partnerId: p.odoo_partner_id, created: false }
  if (!p.name?.trim()) throw new Error('Nom manquant sur la fiche')

  const name  = p.name.trim()
  const parts = name.split(/\s+/)
  const inv   = parts.length > 1 ? [...parts.slice(1), parts[0]].join(' ') : name

  // 1. Chercher un FOURNISSEUR existant (nom ou nom inversé) → on s'y rattache
  //    pour ne pas créer de doublon. On ne matche PAS un simple client homonyme
  //    (on préfère créer un contact dédié plutôt que d'imputer un salaire à un client).
  const matches = await odooRpc<any[]>('res.partner', 'search_read',
    [['|', ['name', 'ilike', name], ['name', 'ilike', inv]]],
    { fields: ['id', 'name', 'supplier_rank'], limit: 10 })
  const supplier = matches.find(m => (m.supplier_rank || 0) > 0)

  let partnerId: number, created = false
  if (supplier) {
    partnerId = supplier.id
    // Complète l'adresse manquante si on l'a
    const vals: any = {}
    if (p.adresse)     vals.street = p.adresse
    if (p.code_postal) vals.zip    = p.code_postal
    if (p.ville)       vals.city   = p.ville
    if (Object.keys(vals).length) { try { await odooRpc('res.partner', 'write', [[partnerId], vals]) } catch {} }
  } else {
    partnerId = await odooRpc<number>('res.partner', 'create', [{
      name, company_type: 'person', supplier_rank: 1,
      street: p.adresse || false, zip: p.code_postal || false, city: p.ville || false,
      phone: p.phone || false, email: p.email || false,
    }])
    created = true
  }
  await sb.from('personnel').update({ odoo_partner_id: partnerId }).eq('id', p.id)
  return { partnerId, created }
}

/**
 * Push automatique : pousse toutes les fiches ÉLIGIBLES non encore poussées —
 * montant net > 0 ET personne liée avec `odoo_partner_id`. Les fiches sans
 * contact Odoo sont ignorées (elles seront reprises au prochain passage une
 * fois l'ID renseigné). Appelé après l'ingestion (cron paie-fetch).
 */
export async function pushEligiblePayslips(): Promise<{ pushed: number; skipped: number; failed: number; eligible: number; partnersCreated: number; details: any[] }> {
  const sb = createAdminClient()

  // 0. Personnes ayant une fiche à pousser (net ≠ 0, non poussée) SANS contact Odoo
  //    → on leur crée/lie le contact d'abord, pour qu'elles deviennent éligibles.
  const { data: pending } = await sb.from('payslips')
    .select('personnel_id').not('montant_net', 'is', null).neq('montant_net', 0)
    .is('odoo_move_id', null).not('personnel_id', 'is', null)
  const pendingIds = [...new Set((pending || []).map((s: any) => s.personnel_id))]
  let partnersCreated = 0
  if (pendingIds.length) {
    const { data: missing } = await sb.from('personnel').select('id').in('id', pendingIds).is('odoo_partner_id', null)
    for (const m of (missing || [])) {
      try { const r = await ensureOdooPartnerForPersonnel(m.id); if (r.created) partnersCreated++ }
      catch (e: any) { console.error('[paie push] création contact Odoo', m.id, e.message) }
    }
  }

  const { data: pers } = await sb.from('personnel').select('id').not('odoo_partner_id', 'is', null)
  const ids = (pers || []).map((p: any) => p.id)
  if (!ids.length) return { pushed: 0, skipped: 0, failed: 0, eligible: 0, partnersCreated, details: [] }

  // Éligible = montant net renseigné et ≠ 0 (négatif accepté : correction de fiche).
  const { data: slips } = await sb.from('payslips')
    .select('id, worker_name').not('montant_net', 'is', null).neq('montant_net', 0)
    .is('odoo_move_id', null).in('personnel_id', ids)

  const details: any[] = []
  for (const s of (slips || [])) {
    try {
      const r = await pushPayslipToOdoo(s.id)
      details.push({ id: s.id, worker: s.worker_name, ok: true, move: r.moveName, skipped: r.skipped })
    } catch (e: any) {
      details.push({ id: s.id, worker: s.worker_name, ok: false, error: e.message })
    }
  }
  return {
    pushed:  details.filter(d => d.ok && !d.skipped).length,
    skipped: details.filter(d => d.skipped).length,
    failed:  details.filter(d => !d.ok).length,
    eligible: (slips || []).length,
    partnersCreated,
    details,
  }
}
