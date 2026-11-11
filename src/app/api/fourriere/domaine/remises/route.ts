// src/app/api/fourriere/domaine/remises/route.ts
//
// Onglet « Remises » de l'écran Domaine (Q6/Q7, préversion ma_journee, Olivier 11/11/2026).
// GET  → { aRattacher: remises non reconnues + fiches qui ressemblent, horsZone: véhicules remis
//          pas encore dans la zone Domaine, zone }
// POST { action: 'rattacher', id, mission_id } → date de remise posée (arrête le gardiennage Parquet)
// POST { action: 'pas_chez_nous', id }         → ligne écartée (outcome 'ignored')
// Le déplacement en zone Domaine passe par l'API de changement de zone, appelée par l'écran (un appel par véhicule).
// Superadmin (comme l'écran Domaine).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { getBusinessText }   from '@/lib/settings/business'
import { rattacherRemise }   from '@/lib/domaine/rattacher-remise'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function superadmin() {
  const s = await getServerSession(authOptions)
  const u = s?.user as any
  return u?.role === 'superadmin' ? u : null
}
const PARC = ['parked', 'unlocated', 'awaiting_payment']

export async function GET() {
  if (!(await superadmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const zone = (await getBusinessText('domaine_zone_parc').catch(() => 'I')) || 'I'
  const { data: lignes, error } = await sb.from('domaine_dates_in')
    .select('id, received_at, remise_date, brand, model, vin, vin_tail, pv_remise_name, outcome')
    .is('matched_mission_id', null).in('outcome', ['no_match', 'ambiguous'])
    .order('remise_date', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Fiches au parc sans date de remise : base des propositions.
  const { data: parc } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, parc_zone_key, parked_at, source')
    .in('status', PARC).eq('dossier_leg', false).is('domaine_remise_date', null).limit(2000)
  const n = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const aRattacher = (lignes || []).map((l: any) => {
    const tail = n(l.vin_tail || String(l.vin || '').slice(-5))
    const marque = n(l.brand)
    const cands = (parc || []).map((m: any) => {
      let score = 0; const raisons: string[] = []
      if (tail && n(m.vehicle_vin).endsWith(tail)) { score += 5; raisons.push('fin de châssis') }
      else if (tail && tail.length >= 4 && n(m.vehicle_vin).includes(tail.slice(-4))) { score += 2; raisons.push('châssis proche') }
      if (marque && n(m.vehicle_brand) && (n(m.vehicle_brand).includes(marque) || marque.includes(n(m.vehicle_brand)))) { score += 2; raisons.push('marque') }
      if (l.model && n(m.vehicle_model) && n(m.vehicle_model).includes(n(l.model).slice(0, 4))) { score += 1; raisons.push('modèle') }
      if (m.source === 'police_saisie' || m.source === 'legacy_odoo') score += 1
      return { id: m.id, mission_number: m.mission_number, plate: m.vehicle_plate, vehicule: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' '), vin: m.vehicle_vin, zone: m.parc_zone_key, score, raisons }
    }).filter((c: any) => c.score >= 2).sort((a: any, b: any) => b.score - a.score).slice(0, 6)
    return { ...l, candidats: cands }
  })
  const { data: hz } = await sb.from('incoming_missions')
    .select('id, vehicle_plate, vehicle_brand, vehicle_model, parc_zone_key, domaine_remise_date')
    .in('status', PARC).eq('dossier_leg', false).not('domaine_remise_date', 'is', null).is('domaine_vente_date', null)
  const horsZone = (hz || []).filter((m: any) => m.parc_zone_key !== zone)
  return NextResponse.json({ ok: true, zone, aRattacher, horsZone }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const u = await superadmin()
  if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  if (body.action === 'rattacher') {
    if (!body.id || !body.mission_id) return NextResponse.json({ error: 'Remise et fiche requises' }, { status: 400 })
    const r = await rattacherRemise(sb, String(body.id), String(body.mission_id), u.id || null)
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status })
  }
  if (body.action === 'pas_chez_nous') {
    if (!body.id) return NextResponse.json({ error: 'Remise requise' }, { status: 400 })
    await sb.from('domaine_dates_in').update({ outcome: 'ignored' }).eq('id', String(body.id)).is('matched_mission_id', null)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
