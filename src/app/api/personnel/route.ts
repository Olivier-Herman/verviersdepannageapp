// src/app/api/personnel/route.ts
//
// Console RH : répertoire du personnel + index des fiches de paie (métadonnées).
// GET  → { personnel, users, periods, payslips }
// POST → { action:'update'|'delete'|'link', ... }
// Superadmin uniquement (phase de test). Olivier 2026-08-01.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { nameKey }                   from '@/lib/paie/process-batch'
import { odooRpc }                   from '@/lib/odoo'
import { ensureOdooPartnerForPersonnel } from '@/lib/paie/push-odoo'
import { compareSlipInfos, latestSlipWithInfos } from '@/lib/paie/compare-infos'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

import { isPersonnelStaff } from '@/lib/rh-access'
const isSuper = isPersonnelStaff

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const [{ data: personnel }, { data: users }, { data: slips }] = await Promise.all([
    sb.from('personnel').select('id, name, company_code, matricule, user_id, active, odoo_partner_id, kind, adresse, code_postal, ville, national_number, iban, etat_civil, personnes_charge').order('name'),
    sb.from('users').select('id, name').order('name'),
    sb.from('payslips').select('id, personnel_id, worker_name, period, company_code, type, label, pages, slip_infos').order('period', { ascending: false }),
  ])
  const uName = new Map((users || []).map((u: any) => [u.id, u.name]))
  const cntByPers = new Map<string, number>()
  const lastByPers = new Map<string, string>()
  const slipsByPers = new Map<string, any[]>()
  for (const s of (slips || [])) {
    if (!s.personnel_id) continue
    cntByPers.set(s.personnel_id, (cntByPers.get(s.personnel_id) || 0) + 1)
    if (!lastByPers.has(s.personnel_id)) lastByPers.set(s.personnel_id, s.period)
    if (!slipsByPers.has(s.personnel_id)) slipsByPers.set(s.personnel_id, [])
    slipsByPers.get(s.personnel_id)!.push(s)
  }
  const personnelOut = (personnel || []).map((p: any) => {
    const ref = latestSlipWithInfos(slipsByPers.get(p.id) || [])
    const mm  = ref ? compareSlipInfos(p, ref.slip_infos) : []
    return {
      ...p, user_name: p.user_id ? (uName.get(p.user_id) || null) : null,
      payslip_count: cntByPers.get(p.id) || 0, last_period: lastByPers.get(p.id) || null,
      mismatch_count: mm.length, mismatch_fields: mm.map((x: any) => x.label),
    }
  })
  const periods = [...new Set((slips || []).map((s: any) => s.period).filter(Boolean))].sort().reverse()

  // Modifications self-service en attente de transmission au secrétariat social.
  const { data: changes } = await sb.from('personnel_changes')
    .select('id, personnel_id, label, old_value, new_value, created_at').eq('transmitted', false)
    .order('created_at', { ascending: false })
  const nameByPers = new Map((personnel || []).map((p: any) => [p.id, p.name]))
  const pendingChanges = (changes || []).map((c: any) => ({ ...c, worker: nameByPers.get(c.personnel_id) || '?' }))

  // Fiches DGJ (3068) poussées à tort dans l'Odoo de Verviers (à nettoyer).
  const { count: dgjPushed } = await sb.from('payslips').select('id', { count: 'exact', head: true })
    .eq('company_code', '3068').not('odoo_move_id', 'is', null)

  return NextResponse.json({ personnel: personnelOut, users: users || [], periods, payslips: slips || [], pendingChanges, dgjPushed: dgjPushed || 0 })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()

  if (action === 'update') {
    const id = String(body.id || ''); if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    const patch: any = {}
    if (typeof body.name === 'string')      { patch.name = body.name.trim(); patch.name_key = nameKey(body.name) }
    if ('matricule' in body)                patch.matricule = String(body.matricule || '').trim() || null
    if ('company_code' in body)             patch.company_code = String(body.company_code || '').trim() || null
    if ('user_id' in body)                  patch.user_id = body.user_id || null
    if ('active' in body)                   patch.active = !!body.active
    if ('poste' in body)                    patch.poste = String(body.poste || '').trim() || null
    if ('statut' in body)                   patch.statut = String(body.statut || '').trim() || null
    if ('type_contrat' in body)             patch.type_contrat = String(body.type_contrat || '').trim() || null
    if ('date_entree' in body)              patch.date_entree = body.date_entree || null
    if ('date_sortie' in body)              patch.date_sortie = body.date_sortie || null
    if ('phone' in body)                    patch.phone = String(body.phone || '').trim() || null
    if ('email' in body)                    patch.email = String(body.email || '').trim() || null
    if ('notes' in body)                    patch.notes = String(body.notes || '').trim() || null
    if ('odoo_partner_id' in body)          patch.odoo_partner_id = body.odoo_partner_id ? Number(body.odoo_partner_id) : null
    // Dossier RH perso
    if ('birth_date' in body)               patch.birth_date = body.birth_date || null
    if ('birth_place' in body)              patch.birth_place = String(body.birth_place || '').trim() || null
    if ('nationalite' in body)              patch.nationalite = String(body.nationalite || '').trim() || null
    if ('national_number' in body)          patch.national_number = String(body.national_number || '').trim() || null
    if ('etat_civil' in body)               patch.etat_civil = String(body.etat_civil || '').trim() || null
    if ('personnes_charge' in body)         patch.personnes_charge = body.personnes_charge === '' || body.personnes_charge == null ? null : Number(body.personnes_charge)
    if ('adresse' in body)                  patch.adresse = String(body.adresse || '').trim() || null
    if ('code_postal' in body)              patch.code_postal = String(body.code_postal || '').trim() || null
    if ('ville' in body)                    patch.ville = String(body.ville || '').trim() || null
    if ('pays' in body)                     patch.pays = String(body.pays || '').trim() || null
    if ('iban' in body)                     patch.iban = String(body.iban || '').replace(/\s+/g, '').toUpperCase() || null
    if ('contact_urgence_nom' in body)      patch.contact_urgence_nom = String(body.contact_urgence_nom || '').trim() || null
    if ('contact_urgence_tel' in body)      patch.contact_urgence_tel = String(body.contact_urgence_tel || '').trim() || null

    await sb.from('personnel').update(patch).eq('id', id)

    // Sync vers le contact Odoo (complète le manquant / met à jour le modifié).
    const { data: p } = await sb.from('personnel').select('odoo_partner_id, name, phone, email, adresse, code_postal, ville').eq('id', id).maybeSingle()
    if (p?.odoo_partner_id) {
      try {
        const vals: any = {}
        if (p.name)        vals.name   = p.name
        if (p.phone)       vals.phone  = p.phone
        if (p.email)       vals.email  = p.email
        if (p.adresse)     vals.street = p.adresse
        if (p.code_postal) vals.zip    = p.code_postal
        if (p.ville)       vals.city   = p.ville
        if (Object.keys(vals).length) await odooRpc('res.partner', 'write', [[p.odoo_partner_id], vals])
      } catch (e: any) { console.error('[personnel] sync Odoo:', e.message) }
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete') {
    const id = String(body.id || '')
    // On détache les fiches (personnel_id → null) avant de supprimer la personne.
    await sb.from('payslips').update({ personnel_id: null }).eq('personnel_id', id)
    await sb.from('personnel').delete().eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'ensure_odoo') {
    // Crée / lie le contact Odoo d'une personne et remplit odoo_partner_id.
    const id = String(body.id || ''); if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    try {
      const r = await ensureOdooPartnerForPersonnel(id)
      return NextResponse.json({ ok: true, ...r })
    } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }) }
  }

  if (action === 'ensure_odoo_all') {
    // Crée / lie le contact Odoo pour toutes les personnes actives sans id.
    const { data: missing } = await sb.from('personnel').select('id').is('odoo_partner_id', null).neq('active', false)
    let created = 0, linked = 0; const errors: any[] = []
    for (const m of (missing || [])) {
      try { const r = await ensureOdooPartnerForPersonnel(m.id); r.created ? created++ : linked++ }
      catch (e: any) { errors.push({ id: m.id, error: e.message }) }
    }
    return NextResponse.json({ ok: true, total: (missing || []).length, created, linked, errors })
  }

  if (action === 'transmit_change') {
    // Marque une modif self-service comme transmise au secrétariat social.
    const id = String(body.id || '')
    if (id === 'all') await sb.from('personnel_changes').update({ transmitted: true, transmitted_at: new Date().toISOString() }).eq('transmitted', false)
    else if (id)     await sb.from('personnel_changes').update({ transmitted: true, transmitted_at: new Date().toISOString() }).eq('id', id)
    else return NextResponse.json({ error: 'id requis' }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'cleanup_dgj_push') {
    // Supprime dans Odoo Verviers les factures de fiches DGJ (3068) poussées à tort
    // + remet payslips.odoo_move_id à zéro.
    const { data: slips } = await sb.from('payslips').select('id, worker_name, odoo_move_id, period')
      .eq('company_code', '3068').not('odoo_move_id', 'is', null)
    let deleted = 0, cancelled = 0; const errors: any[] = []
    for (const s of (slips || [])) {
      try {
        try { await odooRpc('account.move', 'button_draft', [[s.odoo_move_id]]) } catch {}
        await odooRpc('account.move', 'unlink', [[s.odoo_move_id]])
        await sb.from('payslips').update({ odoo_move_id: null }).eq('id', s.id)
        deleted++
      } catch {
        try {
          await odooRpc('account.move', 'button_cancel', [[s.odoo_move_id]])
          await sb.from('payslips').update({ odoo_move_id: null }).eq('id', s.id)
          cancelled++
        } catch (e2: any) { errors.push({ worker: s.worker_name, period: s.period, error: e2.message }) }
      }
    }
    return NextResponse.json({ ok: true, deleted, cancelled, errors })
  }

  if (action === 'reassign') {
    // Réaffecte une fiche à une autre personne.
    const payslipId = String(body.payslip_id || ''), personnelId = body.personnel_id || null
    if (!payslipId) return NextResponse.json({ error: 'payslip_id requis' }, { status: 400 })
    await sb.from('payslips').update({ personnel_id: personnelId }).eq('id', payslipId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
