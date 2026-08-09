// src/app/api/fourriere/saisies/route.ts
//
// Cockpit Facturation SAISIE.
//   GET  → { dossiers, orphans } — dossiers existants + missions police_saisie
//          en parc sans dossier (à intégrer en 1 clic).
//   POST { mission_id } → crée un dossier (snapshot depuis la mission).
//   POST { action:'sync_all' } → crée un dossier pour toutes les saisies orphelines.
// Accès : admin / superadmin / module fourriere. Olivier 2026-08-09.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

const SNAP = 'id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, client_name, parked_at, received_at, levee_saisie_date, requisitoire_at'

function snapshotFromMission(m: any) {
  return {
    mission_id:    m.id,
    vehicle_plate: m.vehicle_plate || null,
    vehicle_brand: m.vehicle_brand || null,
    vehicle_model: m.vehicle_model || null,
    dossier_ref:   m.dossier_number || null,
    parked_at:     (m.parked_at || m.received_at || '').slice(0, 10) || null,
    levee_date:    m.levee_saisie_date ? String(m.levee_saisie_date).slice(0, 10) : null,
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()

  const { data: dossiers } = await sb
    .from('saisie_dossiers')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  // Missions police_saisie EN PARC sans dossier → candidates à intégrer.
  const linked = new Set((dossiers || []).map((d: any) => d.mission_id).filter(Boolean))
  const { data: saisies } = await sb
    .from('incoming_missions')
    .select(SNAP)
    .eq('source', 'police_saisie')
    .in('status', ['parked', 'completed', 'to_invoice'])
    .order('received_at', { ascending: false })
    .limit(200)
  const orphans = (saisies || []).filter((m: any) => !linked.has(m.id))

  return NextResponse.json({ dossiers: dossiers || [], orphans })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))

  // Intégration en masse de toutes les saisies orphelines.
  if (body.action === 'sync_all') {
    const { data: dossiers } = await sb.from('saisie_dossiers').select('mission_id')
    const linked = new Set((dossiers || []).map((d: any) => d.mission_id).filter(Boolean))
    const { data: saisies } = await sb.from('incoming_missions').select(SNAP)
      .eq('source', 'police_saisie').in('status', ['parked', 'completed', 'to_invoice']).limit(200)
    const toCreate = (saisies || []).filter((m: any) => !linked.has(m.id)).map(snapshotFromMission)
    if (toCreate.length === 0) return NextResponse.json({ ok: true, created: 0 })
    const { error } = await sb.from('saisie_dossiers').insert(toCreate)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, created: toCreate.length })
  }

  // Création unitaire depuis une mission.
  const missionId = String(body.mission_id || '')
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
  const { data: m } = await sb.from('incoming_missions').select(SNAP).eq('id', missionId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const { data: dossier, error } = await sb.from('saisie_dossiers')
    .insert(snapshotFromMission(m)).select('*').single()
  if (error) {
    if (String(error.message).includes('duplicate')) return NextResponse.json({ error: 'Un dossier existe déjà pour cette mission' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, dossier })
}
