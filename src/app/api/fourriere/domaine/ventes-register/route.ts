// src/app/api/fourriere/domaine/ventes-register/route.ts
//
// Registre « Vente d'épaves » (reflet des mails de Rosemarie, toutes lignes).
// GET  ?from&to                         → registre calculé (trace-based).
// POST { action, id, value }            → éditions par ligne de trace :
//        set_date_out  (value=YYYY-MM-DD|null)  Date OUT éditable
//        set_sortie    (value=YYYY-MM-DD|null)  date de sortie réelle → si la ligne
//                       est rapprochée, passe la fiche en « à facturer » (cachet
//                       Domaine). Aucun impact sur les jours facturés.
//        toggle_prepare (value=bool)            « Préparation OK »
// Accès : admin / superadmin / module fourriere. Olivier 2026-07-30.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { computeVenteEpavesRegister } from '@/lib/domaine/vente-epaves-register'
import { syncVenteEpavesParc } from '@/lib/domaine/vente-epaves-parc-sync'
import { odooRpc, withOdooActor } from '@/lib/odoo'
import { releaseParcAndShift } from '@/lib/parc/release'

const ODOO_URL = process.env.ODOO_URL || ''

export const dynamic     = 'force-dynamic'
export const fetchCache  = 'force-no-store'
export const maxDuration = 30

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const from = (searchParams.get('from') || '').slice(0, 10)
  const to   = (searchParams.get('to')   || '').slice(0, 10)
  if (!from || !to) return NextResponse.json({ error: 'Période (from/to) requise' }, { status: 400 })
  const sb = createAdminClient()
  const result = await computeVenteEpavesRegister(sb, from, to)
  // N° de facture Domaine mémorisé pour cette période (si déjà saisi).
  const { data: inv } = await sb.from('app_settings').select('value').eq('key', `domaine_invoice_${from}_${to}`).maybeSingle()
  let invoiceNumber = ''
  try { const v = inv?.value ? (typeof inv.value === 'string' ? JSON.parse(inv.value) : inv.value) : null; invoiceNumber = v?.number || '' } catch {}
  return NextResponse.json({ ok: true, ...result, invoiceNumber })
}

// Ligne rapprochée + sortie réelle → fiche « à facturer » (cachet Domaine).
async function toInvoiceIfMatched(sb: any, r: any, sortie: string, userId: string | null): Promise<boolean> {
  if (!sortie || !r.matched_mission_id) return false
  const { data: m } = await sb.from('incoming_missions')
    .select('id, status, completed_at').eq('id', r.matched_mission_id).maybeSingle()
  if (!m || !['parked', 'new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering'].includes(m.status)) return false
  const now = new Date().toISOString()
  await sb.from('incoming_missions').update({ status: 'to_invoice', completed_at: m.completed_at || now, updated_at: now }).eq('id', m.id)
  await sb.from('mission_logs').insert({
    mission_id: m.id, actor_id: userId, action: 'domaine_sortie',
    notes: `Sortie réelle Domaine ${sortie}${r.firm ? ` (vendu à ${r.firm})` : ''} → à facturer`,
    metadata: { source: 'vente_epaves', sortie, domaine_ref: r.numero },
  }).then(() => {}, () => {})
  return true
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const user = session!.user as any
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()

  // Synchronisation avec le PARC (à l'ouverture de la page) : retente le
  // rapprochement des lignes non rapprochées avec les fiches en parc. Ne relit
  // PAS les mails (gérés par le cron).
  if (action === 'sync_parc') {
    const summary = await syncVenteEpavesParc(sb)
    return NextResponse.json({ ok: true, summary })
  }

  // Sortie réelle au niveau de la VENTE : propage à toutes les lignes de la vente
  // (les épaves d'une même soumission partent ensemble). Éditable par ligne ensuite.
  if (action === 'set_sortie_vente') {
    const venteDate = String(body.venteDate || '').slice(0, 10)
    const value = body.value ? String(body.value).slice(0, 10) : null
    if (!venteDate) return NextResponse.json({ error: 'venteDate requis' }, { status: 400 })
    const { data: rows } = await sb.from('domaine_ventes_epaves')
      .select('id, matched_mission_id, numero, firm').eq('vente_date', venteDate)
    await sb.from('domaine_ventes_epaves').update({ sortie_reelle_date: value }).eq('vente_date', venteDate)
    let facturable = 0
    if (value) for (const r of (rows || [])) { if (await toInvoiceIfMatched(sb, r, value, user.id || null)) facturable++ }
    return NextResponse.json({ ok: true, facturable, lines: (rows || []).length })
  }

  // N° de facture Odoo du TRIMESTRE → passe les fiches rapprochées « à facturer »
  // de la période en « terminé » avec ce n° (VD Soft = facturation manuelle).
  if (action === 'complete_quarter') {
    const from = String(body.from || '').slice(0, 10)
    const to   = String(body.to   || '').slice(0, 10)
    const invoiceNumber = String(body.invoiceNumber || '').trim()
    if (!from || !to || !invoiceNumber) return NextResponse.json({ error: 'from / to / invoiceNumber requis' }, { status: 400 })
    // Fiches rapprochées des ventes de la période.
    const { data: trace } = await sb.from('domaine_ventes_epaves')
      .select('matched_mission_id').gte('vente_date', from).lte('vente_date', to).not('matched_mission_id', 'is', null)
    const ids = [...new Set((trace || []).map((r: any) => r.matched_mission_id))]
    // Récupère l'id/URL Odoo de la facture (best-effort) via son n°.
    let moveId: number | null = null, url: string | null = null
    try {
      const mv = await withOdooActor(user.id, () => odooRpc<any[]>('account.move', 'search_read', [[['name', '=', invoiceNumber]]], { fields: ['id'], limit: 1 }))
      if (mv?.[0]?.id) { moveId = mv[0].id; url = `${ODOO_URL}/web#id=${moveId}&model=account.move&view_type=form` }
    } catch {}
    let completed = 0
    const now = new Date().toISOString()
    if (ids.length) {
      const { data: toComp } = await sb.from('incoming_missions').select('id').in('id', ids).eq('status', 'to_invoice')
      for (const m of (toComp || [])) {
        await sb.from('incoming_missions').update({
          status: 'completed', invoice_method: 'manual', invoice_number: invoiceNumber,
          invoice_odoo_id: moveId, invoice_url: url, invoiced_at: now, invoiced_by: user.id || null, updated_at: now,
        }).eq('id', m.id)
        try { await releaseParcAndShift(sb, m.id) } catch {}
        await sb.from('mission_logs').insert({
          mission_id: m.id, actor_id: user.id || null, action: 'invoiced',
          notes: `Facturée Domaine n° ${invoiceNumber} (trimestre ${from} → ${to})`,
          metadata: { source: 'domaine', invoice_number: invoiceNumber, from, to },
        }).then(() => {}, () => {})
        completed++
      }
    }
    await sb.from('app_settings').upsert({ key: `domaine_invoice_${from}_${to}`, value: { number: invoiceNumber, moveId, at: now } }, { onConflict: 'key' }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, completed, invoiceNumber })
  }

  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const { data: row } = await sb.from('domaine_ventes_epaves')
    .select('id, matched_mission_id, sortie_reelle_date, numero, firm, brand, model, vin, date_out, max_enlevement_date').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Ligne introuvable' }, { status: 404 })

  // Réimpression de l'étiquette VENDU DOMAINE de la ligne (matched → infos fiche).
  if (action === 'reprint') {
    let m: any = null
    if (row.matched_mission_id) {
      const { data: mm } = await sb.from('incoming_missions')
        .select('id, mission_number, vehicle_plate, vehicle_vin, parc_zone_key').eq('id', row.matched_mission_id).maybeSingle()
      m = mm
    }
    try {
      const { buildEpaveLabelZPL } = await import('@/lib/print/zpl-templates/epave-label')
      const { printZPLRaw } = await import('@/lib/print/zebra-raw')
      const zpl = buildEpaveLabelZPL({
        missionId: m?.id || row.id, missionNumber: m?.mission_number ?? null,
        firm: row.firm || '', dateOut: row.date_out || row.max_enlevement_date,
        brand: row.brand, model: row.model, plate: m?.vehicle_plate,
        vin: m?.vehicle_vin || row.vin, zone: m?.parc_zone_key,
      })
      const res = await printZPLRaw(zpl, { missionId: m?.id || null })
      return NextResponse.json({ ok: true, queued: !!res.queued })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'échec impression' }, { status: 502 })
    }
  }

  if (action === 'set_date_out') {
    await sb.from('domaine_ventes_epaves').update({ date_out: body.value ? String(body.value).slice(0, 10) : null }).eq('id', id)
    return NextResponse.json({ ok: true })
  }
  if (action === 'toggle_prepare') {
    const on = !!body.value
    await sb.from('domaine_ventes_epaves').update({ prepare_at: on ? new Date().toISOString() : null }).eq('id', id)
    // Préparé ⇒ le véhicule est forcément en bonne zone (Domaine / I). Transfert
    // auto si la fiche rapprochée est encore ailleurs.
    let transferred = false
    if (on && row.matched_mission_id) {
      const { data: m } = await sb.from('incoming_missions')
        .select('id, status, parc_zone_key').eq('id', row.matched_mission_id).maybeSingle()
      if (m && m.status === 'parked' && m.parc_zone_key !== 'I') {
        await sb.from('incoming_missions').update({
          parc_zone_key: 'I', parc_row_number: null, parc_slot_index: null, updated_at: new Date().toISOString(),
        }).eq('id', m.id)
        await sb.from('mission_logs').insert({
          mission_id: m.id, actor_id: user.id || null, action: 'parc_transfer',
          notes: `Transféré en zone Domaine (I) suite à « Préparation OK » (vente d'épave)`,
          metadata: { from_zone_key: m.parc_zone_key, to_zone_key: 'I', source: 'vente_epaves_prepare' },
        }).then(() => {}, () => {})
        transferred = true
      }
    }
    return NextResponse.json({ ok: true, transferred })
  }
  if (action === 'set_sortie') {
    const value = body.value ? String(body.value).slice(0, 10) : null
    await sb.from('domaine_ventes_epaves').update({ sortie_reelle_date: value }).eq('id', id)
    const facturable = value ? await toInvoiceIfMatched(sb, row, value, user.id || null) : false
    return NextResponse.json({ ok: true, facturable })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
