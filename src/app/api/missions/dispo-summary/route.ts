// src/app/api/missions/dispo-summary/route.ts
//
// GET ?plate= → les fiches disponibles dans Momo Market pour CETTE plaque, sur
// 3 h (Olivier 20/09/2026 : plus large que les 45 min de Momo Market — « on ne
// sait jamais »), avec pour chacune si elle est COUVERTE par une assistance.
// Sert l'écran de création chauffeur : un « Siabis couvert » ne se crée jamais
// à la main — soit la fiche de l'assistance existe (on la prend), soit c'est
// un Siabis non couvert (le client paie, se fait rembourser après).
// Non couverte = source police_snc, ou couverture pas tranchée, ou COMEX qui
// dit « véhicule pas couvert ».

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { comexVehiculeNonCouvert } from '@/lib/touring/map-mission'

export const dynamic = 'force-dynamic'
const WINDOW_MIN = 180
const norm = (s: string) => String(s || '').replace(/[-.\s_/]/g, '').toUpperCase()

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const plate = norm(new URL(req.url).searchParams.get('plate') || '')
  if (plate.length < 4) return NextResponse.json({ ok: true, plate, rows: [], covered: 0, uncovered: 0 })
  const sb = createAdminClient()
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString()
  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, source, source_format, mission_type, status, vehicle_plate, vehicle_brand, vehicle_model, incident_city, incident_address, external_id, received_at, needs_siabis_decision, raw_content')
    .in('status', ['new', 'dispatching']).is('assigned_to', null).eq('dossier_leg', false)
    .neq('source', 'garage').neq('source', 'unknown').gte('received_at', since)
    .order('received_at', { ascending: false }).limit(200)
  const rows = (data || []).filter(m => norm(m.vehicle_plate || '') === plate).map(m => {
    let comexNc = false
    if (m.source_format === 'comex') { try { comexNc = comexVehiculeNonCouvert(JSON.parse(m.raw_content || '{}')) } catch { /* pas de JSON */ } }
    const covered = m.source !== 'police_snc' && !m.needs_siabis_decision && !comexNc
    return { id: m.id, mission_number: m.mission_number, source: m.source, mission_type: m.mission_type, vehicle_plate: m.vehicle_plate, brand: m.vehicle_brand, model: m.vehicle_model, city: m.incident_city || m.incident_address, external_id: m.external_id, received_at: m.received_at, covered }
  })
  return NextResponse.json({ ok: true, plate, rows, covered: rows.filter(r => r.covered).length, uncovered: rows.filter(r => !r.covered).length })
}
