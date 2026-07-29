// src/app/api/fourriere/domaine-dates-in/route.ts
//
// GET  → lignes « Dates IN » (remises Domaine) + fiche liée (n°, zone, statut).
// POST → { action:'sync' } : force une capture immédiate des mails Dates IN.
// Superadmin uniquement (phase actuelle). Olivier 2026-07-29.

import { NextResponse }       from 'next/server'
import { getServerSession }   from 'next-auth'
import { authOptions }        from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import { pollDomaineDatesIn } from '@/lib/domaine/intake'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function requireSuperadmin() {
  const session = await getServerSession(authOptions)
  return (session?.user as any)?.role === 'superadmin' ? session : null
}

export async function GET() {
  if (!(await requireSuperadmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()

  const { data: rows } = await sb.from('domaine_dates_in')
    .select('id, received_at, remise_date, brand, model, vin, vin_tail, pv_remise_name, matched_mission_id, outcome, applied_date, created_at')
    .order('remise_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000)

  // Enrichit avec la fiche liée : n° mission, zone parc, statut.
  const missionIds = Array.from(new Set((rows || []).map(r => r.matched_mission_id).filter(Boolean)))
  const byId = new Map<string, any>()
  if (missionIds.length) {
    const { data: ms } = await sb.from('incoming_missions')
      .select('id, mission_number, parc_zone_key, status, vehicle_plate, domaine_remise_date, domaine_vente_firm, domaine_vente_date, domaine_enlevement_date')
      .in('id', missionIds)
    for (const m of (ms || [])) byId.set(m.id, m)
  }

  const items = (rows || []).map(r => {
    const m = r.matched_mission_id ? byId.get(r.matched_mission_id) : null
    return {
      ...r,
      vehicle: [r.brand, r.model].filter(Boolean).join(' '),
      mission_number: m?.mission_number ?? null,
      zone:           m?.parc_zone_key ?? null,
      mission_status: m?.status ?? null,
      plate:          m?.vehicle_plate ?? null,
      firm:           m?.domaine_vente_firm ?? null,
      vente_date:     m?.domaine_vente_date ?? null,
      date_out:       m?.domaine_enlevement_date ?? null,
    }
  })

  const counts = {
    total: items.length,
    applied:    items.filter(i => i.outcome === 'applied').length,
    alreadySet: items.filter(i => i.outcome === 'already_set').length,
    noMatch:    items.filter(i => i.outcome === 'no_match').length,
    ambiguous:  items.filter(i => i.outcome === 'ambiguous').length,
  }
  const { data: lr } = await sb.from('app_settings').select('value').eq('key', 'domaine_dates_in_last_run').maybeSingle()

  return NextResponse.json({ items, counts, lastRun: lr?.value ?? null })
}

export async function POST(req: Request) {
  if (!(await requireSuperadmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))

  // Réimpression manuelle d'une étiquette DOMAINE (si besoin).
  if (body?.action === 'reprint') {
    const sb = createAdminClient()
    const { data: row } = await sb.from('domaine_dates_in')
      .select('id, remise_date, vin, pv_remise_name, matched_mission_id').eq('id', String(body.id || '')).maybeSingle()
    if (!row?.matched_mission_id) return NextResponse.json({ error: 'Aucune fiche liée à cette ligne' }, { status: 400 })
    const { data: m } = await sb.from('incoming_missions')
      .select('id, mission_number, vehicle_brand, vehicle_model, vehicle_plate, vehicle_vin, parc_zone_key')
      .eq('id', row.matched_mission_id).maybeSingle()
    if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
    try {
      const { buildDomaineLabelZPL } = await import('@/lib/print/zpl-templates/domaine-label')
      const { printZPLRaw } = await import('@/lib/print/zebra-raw')
      const zpl = buildDomaineLabelZPL({
        missionId: m.id, missionNumber: m.mission_number, remiseDate: row.remise_date,
        brand: m.vehicle_brand, model: m.vehicle_model, plate: m.vehicle_plate,
        vin: m.vehicle_vin || row.vin, zone: m.parc_zone_key, pvName: row.pv_remise_name,
      })
      const res = await printZPLRaw(zpl, { missionId: m.id })
      return NextResponse.json({ ok: true, queued: !!res.queued })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'échec impression' }, { status: 502 })
    }
  }

  if (body?.action !== 'sync') return NextResponse.json({ error: 'action inconnue' }, { status: 400 })
  try {
    const summary = await pollDomaineDatesIn()
    const sb = createAdminClient()
    await sb.from('app_settings').upsert(
      { key: 'domaine_dates_in_last_run', value: { at: new Date().toISOString(), ...summary } },
      { onConflict: 'key' },
    ).then(() => {}, () => {})
    return NextResponse.json({ ok: true, ...summary })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'échec sync' }, { status: 502 })
  }
}
