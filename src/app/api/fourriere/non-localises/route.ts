// src/app/api/fourriere/non-localises/route.ts
//
// GET /api/fourriere/non-localises
// Liste les vehicules en status='unlocated' (perdus lors d un inventaire de
// zone). Triable par date de perte la plus recente d abord.
//
// POST /api/fourriere/non-localises
// Body: { mission_id, action: 'release' | 'cancel' }
//   - release : status → 'completed', clear parc_zone_key (sortie definitive)
//   - cancel  : status → 'cancelled' (vehicule jamais arrive / erreur)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function checkAccess(session: any): { ok: boolean; user?: any } {
  if (!session) return { ok: false }
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return { ok: false }
  }
  return { ok: true, user }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  const access = checkAccess(session)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model,
      vehicle_vin, client_name, billed_to_name, source, received_at,
      parc_zone_key, parc_row_number, parc_slot_index,
      unlocated_at, unlocated_zone, status, updated_at
    `)
    .eq('status', 'unlocated')
    .order('unlocated_at', { ascending: false, nullsFirst: false })
    .order('updated_at',   { ascending: false })

  if (error) {
    // Si la colonne unlocated_at n existe pas encore : retry sans
    if (/unlocated_at|unlocated_zone/.test(error.message)) {
      const { data: fallback, error: e2 } = await sb
        .from('incoming_missions')
        .select(`
          id, external_id, dossier_number, vehicle_plate, vehicle_brand, vehicle_model,
          vehicle_vin, client_name, billed_to_name, source, received_at,
          parc_zone_key, parc_row_number, parc_slot_index, status, updated_at
        `)
        .eq('status', 'unlocated')
        .order('updated_at', { ascending: false })
      if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
      return NextResponse.json({ vehicles: fallback || [], migration_missing: true })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ vehicles: data || [] })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const access = checkAccess(session)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const missionId = String(body.mission_id || '').trim()
  const action    = String(body.action || '').trim()
  if (!missionId || !['release', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'mission_id et action (release|cancel) requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Verifie que la mission est bien en unlocated (idempotence + securite)
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('id, status, vehicle_plate, unlocated_zone')
    .eq('id', missionId)
    .maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (mission.status !== 'unlocated') {
    return NextResponse.json({ error: `Mission n est pas en unlocated (status=${mission.status})` }, { status: 409 })
  }

  const updates: Record<string, any> = {
    parc_zone_key:   null,
    parc_row_number: null,
    parc_slot_index: null,
    unlocated_at:    null,
    unlocated_zone:  null,
  }
  if (action === 'release') {
    updates.status = 'completed'
  } else {
    updates.status = 'cancelled'
  }

  const { error: upErr } = await sb.from('incoming_missions').update(updates).eq('id', missionId)
  if (upErr) {
    // Retry sans unlocated_* si migration pas appliquee
    if (/unlocated_at|unlocated_zone/.test(upErr.message)) {
      const fallback = { ...updates }
      delete fallback.unlocated_at
      delete fallback.unlocated_zone
      const { error: e2 } = await sb.from('incoming_missions').update(fallback).eq('id', missionId)
      if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
    } else {
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }
  }

  // Log mission_logs
  await sb.from('mission_logs').insert({
    mission_id: missionId,
    actor_id:   (access.user as any).id,
    action:     action === 'release' ? 'unlocated_released' : 'unlocated_cancelled',
    notes:      action === 'release'
      ? `Sortie définitive depuis non-localisés (zone d origine: ${mission.unlocated_zone || '—'})`
      : `Annulé depuis non-localisés (zone d origine: ${mission.unlocated_zone || '—'})`,
    metadata:   { source_zone: mission.unlocated_zone, from: 'non-localises' },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, mission_id: missionId, action })
}
