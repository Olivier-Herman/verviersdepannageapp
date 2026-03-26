// src/app/api/missions/driver-action/route.ts
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

type DriverAction = 'accept' | 'on_way' | 'on_site' | 'completed' | 'park' | 'redeliver'

const ACTION_MAP: Record<DriverAction, { status: string; timestampField?: string; logMessage: string }> = {
  accept:    { status: 'accepted',    timestampField: 'accepted_at',  logMessage: 'Mission acceptée par le chauffeur' },
  on_way:    { status: 'in_progress', timestampField: 'on_way_at',    logMessage: 'Chauffeur en route' },
  on_site:   { status: 'in_progress', timestampField: 'on_site_at',   logMessage: 'Chauffeur sur place' },
  completed: { status: 'completed',   timestampField: 'completed_at', logMessage: 'Mission terminée' },
  park:      { status: 'parked',      timestampField: 'parked_at',    logMessage: 'Véhicule mis en dépôt' },
  redeliver: { status: 'in_progress',                                 logMessage: 'Relivraison en cours' },
}

const ALLOWED: Record<string, DriverAction[]> = {
  assigned:    ['accept'],
  accepted:    ['on_way'],
  in_progress: ['on_site', 'completed', 'park'],
  parked:      ['redeliver', 'completed'],
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mission_id, action, closing_data, park_data } = await req.json() as {
    mission_id:   string
    action:       DriverAction
    closing_data?: {
      final_mission_type?:  string
      mileage?:             number
      destination_address?: string
      extra_addresses?:     string[]
      photo_urls?:          string[]
      signature_data?:      string
      signature_name?:      string
      closing_notes?:       string
    }
    park_data?: {
      stage_id?:   number
      stage_name?: string
      notes?:      string
    }
  }

  if (!mission_id || !action || !ACTION_MAP[action]) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: actor } = await supabase
    .from('users').select('id').eq('email', session.user.email!).single()
  if (!actor) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 })

  const { data: mission, error: fetchError } = await supabase
    .from('incoming_missions').select('id, status, assigned_to').eq('id', mission_id).single()
  if (fetchError || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (mission.assigned_to !== actor.id) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const allowed = ALLOWED[mission.status] ?? []
  if (!allowed.includes(action)) {
    return NextResponse.json(
      { error: `Action '${action}' non permise depuis '${mission.status}'` },
      { status: 422 }
    )
  }

  const mapping = ACTION_MAP[action]
  const now     = new Date().toISOString()

  const updatePayload: Record<string, unknown> = {
    status:     mapping.status,
    updated_at: now,
  }
  if (mapping.timestampField) updatePayload[mapping.timestampField] = now

  // Mise en dépôt
  if (action === 'park' && park_data) {
    if (park_data.stage_id)   updatePayload.park_stage_id   = park_data.stage_id
    if (park_data.stage_name) updatePayload.park_stage_name = park_data.stage_name
    if (park_data.notes)      updatePayload.closing_notes   = park_data.notes
  }

  // Données de clôture
  if (action === 'completed' && closing_data) {
    if (closing_data.final_mission_type)      updatePayload.mission_type          = closing_data.final_mission_type
    if (closing_data.mileage != null)         updatePayload.vehicle_mileage        = closing_data.mileage
    if (closing_data.destination_address)     updatePayload.destination_address    = closing_data.destination_address
    if (closing_data.extra_addresses?.length) updatePayload.extra_addresses        = closing_data.extra_addresses
    if (closing_data.photo_urls?.length)      updatePayload.driver_photos          = closing_data.photo_urls
    if (closing_data.signature_data)          updatePayload.client_signature       = closing_data.signature_data
    if (closing_data.signature_name)          updatePayload.client_signature_name  = closing_data.signature_name
    if (closing_data.closing_notes)           updatePayload.closing_notes          = closing_data.closing_notes
  }

  const { data: updated, error: updateError } = await supabase
    .from('incoming_missions').update(updatePayload).eq('id', mission_id).select().single()

  if (updateError) {
    console.error('[driver-action]', updateError)
    return NextResponse.json({ error: 'Erreur mise à jour' }, { status: 500 })
  }

  await supabase.from('mission_logs').insert({
    mission_id,
    actor_id: actor.id,
    action,
    notes:    mapping.logMessage,
    metadata: { action, status: mapping.status, park_data },
  })

  return NextResponse.json({ ok: true, mission: updated })
}
