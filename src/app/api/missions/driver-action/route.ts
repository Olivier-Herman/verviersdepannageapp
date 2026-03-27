// src/app/api/missions/driver-action/route.ts
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

type DriverAction = 'accept' | 'on_way' | 'on_site' | 'completed' | 'park'
  | 'start_delivery' | 'arrive_stop' | 'complete_delivery'

const ACTION_MAP: Record<string, { status: string; timestampField?: string; logMessage: string }> = {
  accept:           { status: 'accepted',    timestampField: 'accepted_at',   logMessage: 'Mission acceptée par le chauffeur' },
  on_way:           { status: 'in_progress', timestampField: 'on_way_at',     logMessage: 'Chauffeur en route' },
  on_site:          { status: 'in_progress', timestampField: 'on_site_at',    logMessage: 'Chauffeur sur place' },
  completed:        { status: 'completed',   timestampField: 'completed_at',  logMessage: 'Mission terminée' },
  park:             { status: 'parked',      timestampField: 'parked_at',     logMessage: 'Véhicule mis en dépôt' },
  start_delivery:   { status: 'delivering',  timestampField: 'delivering_at', logMessage: 'Livraisons en cours' },
  arrive_stop:      { status: 'delivering',                                   logMessage: 'Arrivée à un stop' },
  complete_delivery:{ status: 'completed',   timestampField: 'completed_at',  logMessage: 'Livraisons terminées' },
}

const ALLOWED: Record<string, string[]> = {
  assigned:    ['accept'],
  accepted:    ['on_way'],
  in_progress: ['on_site', 'completed', 'park', 'start_delivery'],
  parked:      ['completed', 'start_delivery'],
  delivering:  ['arrive_stop', 'complete_delivery', 'park'],
}

interface Stop {
  id:         string
  type:       string
  label:      string
  address:    string
  lat:        number | null
  lng:        number | null
  arrived_at: string | null
  sort_order: number
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    mission_id:    string
    action:        string
    closing_data?: {
      final_mission_type?:  string
      mileage?:             number
      destination_address?: string
      destination_lat?:     number
      destination_lng?:     number
      extra_addresses?:     string[]
      stops?:               Stop[]
      photo_urls?:          string[]
      signature?:           string
      signature_data?:      string
      signature_name?:      string
      closing_notes?:       string
      payment_method?:      string
      amount_collected?:    number
      closing_mode?:        string
      depot?:               { id?: string; name?: string } | null
      discharge_motif?:     string
      discharge_name?:      string
      discharge_sig?:       string
    }
    park_data?: {
      stage_id?:   number
      stage_name?: string
      notes?:      string
    }
    // Pour arrive_stop
    stop_id?:    string
    // Pour reorder
    stops?:      Stop[]
  }

  const { mission_id, action, closing_data, park_data } = body

  if (!mission_id || !action || !ACTION_MAP[action]) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: actor } = await supabase
    .from('users').select('id, name').eq('email', session.user.email!).single()
  if (!actor) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 })

  const { data: mission, error: fetchError } = await supabase
    .from('incoming_missions')
    .select('id, status, assigned_to, external_id, vehicle_plate, vehicle_brand, vehicle_model, amount_to_collect, source, extra_addresses')
    .eq('id', mission_id).single()

  if (fetchError || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if (mission.assigned_to !== actor.id) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const allowed = ALLOWED[mission.status] ?? []
  if (!allowed.includes(action)) {
    return NextResponse.json({ error: `Action '${action}' non permise depuis '${mission.status}'` }, { status: 422 })
  }

  const mapping = ACTION_MAP[action]
  const now     = new Date().toISOString()

  const updatePayload: Record<string, unknown> = {
    status:     mapping.status,
    updated_at: now,
  }
  if (mapping.timestampField) updatePayload[mapping.timestampField] = now

  // ── Dépôt en parc ──────────────────────────────────────────────────────────
  if (action === 'park' && park_data) {
    if (park_data.stage_id)   updatePayload.park_stage_id   = park_data.stage_id
    if (park_data.stage_name) updatePayload.park_stage_name = park_data.stage_name
    if (park_data.notes)      updatePayload.closing_notes   = park_data.notes
  }
  // closing_data peut aussi accompagner un park (rapport partiel avant mise en dépôt)
  if (action === 'park' && closing_data) {
    if (closing_data.final_mission_type) updatePayload.mission_type    = closing_data.final_mission_type
    if (closing_data.mileage != null)    updatePayload.vehicle_mileage = closing_data.mileage
    if (closing_data.photo_urls?.length) updatePayload.driver_photos   = closing_data.photo_urls
    if (closing_data.closing_notes)      updatePayload.closing_notes   = closing_data.closing_notes
    if (closing_data.signature)          updatePayload.client_signature = closing_data.signature
    if (closing_data.discharge_motif)    updatePayload.discharge_motif = closing_data.discharge_motif
    if (closing_data.discharge_name)     updatePayload.discharge_name  = closing_data.discharge_name
    if (closing_data.discharge_sig)      updatePayload.discharge_sig   = closing_data.discharge_sig
  }

  // ── Démarrage des livraisons (rapport soumis) ─────────────────────────────
  if (action === 'start_delivery' && closing_data) {
    if (closing_data.final_mission_type)  updatePayload.mission_type     = closing_data.final_mission_type
    if (closing_data.mileage != null)     updatePayload.vehicle_mileage  = closing_data.mileage
    if (closing_data.destination_address) updatePayload.destination_address = closing_data.destination_address
    if (closing_data.photo_urls?.length)  updatePayload.driver_photos    = closing_data.photo_urls
    if (closing_data.signature)           updatePayload.client_signature = closing_data.signature
    if (closing_data.signature_data)      updatePayload.client_signature = closing_data.signature_data
    if (closing_data.signature_name)      updatePayload.client_signature_name = closing_data.signature_name
    if (closing_data.closing_notes)       updatePayload.closing_notes    = closing_data.closing_notes
    if (closing_data.closing_mode)        updatePayload.dispatch_mode    = closing_data.closing_mode
    if (closing_data.discharge_motif)     updatePayload.discharge_motif  = closing_data.discharge_motif
    if (closing_data.discharge_name)      updatePayload.discharge_name   = closing_data.discharge_name
    if (closing_data.discharge_sig)       updatePayload.discharge_sig    = closing_data.discharge_sig
    // Stocker les stops en DB
    if (closing_data.stops?.length) {
      updatePayload.extra_addresses = closing_data.stops
    }
  }

  // ── Arrivée à un stop ──────────────────────────────────────────────────────
  if (action === 'arrive_stop' && body.stop_id) {
    const currentStops: Stop[] = (mission.extra_addresses as Stop[]) || []
    const updatedStops = currentStops.map(s =>
      s.id === body.stop_id ? { ...s, arrived_at: now } : s
    )
    updatePayload.extra_addresses = updatedStops
    // Ne pas changer le statut
    updatePayload.status = 'delivering'
  }

  // ── Réordonnancement des stops ─────────────────────────────────────────────
  if (action === 'arrive_stop' && body.stops) {
    updatePayload.extra_addresses = body.stops
  }

  // ── Fin des livraisons ─────────────────────────────────────────────────────
  if (action === 'complete_delivery' && closing_data) {
    if (closing_data.closing_notes) updatePayload.closing_notes = closing_data.closing_notes
    // Mise en dépôt ou terminé selon closing_mode
    if (closing_data.closing_mode === 'depot' && closing_data.depot) {
      updatePayload.status          = 'parked'
      updatePayload.parked_at       = now
      updatePayload.park_stage_name = closing_data.depot.name || 'Dépôt'
      delete updatePayload.completed_at
    }
  }

  // ── Clôture directe (DSP/DPR) ──────────────────────────────────────────────
  if (action === 'completed' && closing_data) {
    if (closing_data.final_mission_type)      updatePayload.mission_type         = closing_data.final_mission_type
    if (closing_data.mileage != null)         updatePayload.vehicle_mileage      = closing_data.mileage
    if (closing_data.destination_address)     updatePayload.destination_address  = closing_data.destination_address
    if (closing_data.extra_addresses?.length) updatePayload.extra_addresses      = closing_data.extra_addresses
    if (closing_data.photo_urls?.length)      updatePayload.driver_photos        = closing_data.photo_urls
    if (closing_data.signature)               updatePayload.client_signature     = closing_data.signature
    if (closing_data.signature_data)          updatePayload.client_signature     = closing_data.signature_data
    if (closing_data.signature_name)          updatePayload.client_signature_name = closing_data.signature_name
    if (closing_data.closing_notes)           updatePayload.closing_notes        = closing_data.closing_notes
    if (closing_data.payment_method)          updatePayload.payment_method       = closing_data.payment_method
    if (closing_data.amount_collected != null) updatePayload.amount_collected    = closing_data.amount_collected
    if (closing_data.discharge_motif)         updatePayload.discharge_motif      = closing_data.discharge_motif
    if (closing_data.discharge_name)          updatePayload.discharge_name       = closing_data.discharge_name
    if (closing_data.discharge_sig)           updatePayload.discharge_sig        = closing_data.discharge_sig
  }

  const { data: updated, error: updateError } = await supabase
    .from('incoming_missions').update(updatePayload).eq('id', mission_id).select().single()

  if (updateError) {
    console.error('[driver-action]', updateError)
    return NextResponse.json({ error: 'Erreur mise à jour' }, { status: 500 })
  }

  // ── Encaissement automatique ───────────────────────────────────────────────
  if (action === 'completed' && closing_data?.amount_collected && closing_data.amount_collected > 0) {
    await supabase.from('interventions').insert({
      driver_id:      actor.id,
      plate:          mission.vehicle_plate || '',
      brand_text:     mission.vehicle_brand || '',
      model_text:     mission.vehicle_model || '',
      amount:         closing_data.amount_collected,
      payment_mode:   closing_data.payment_method || 'cash',
      client_name:    updated.client_name || '',
      notes:          `Mission ${mission.external_id || mission_id.slice(0, 8)} — ${mission.source || ''}`,
      mission_id,
      auto_created:   true,
      synced_to_odoo: false,
    })
  }

  await supabase.from('mission_logs').insert({
    mission_id,
    actor_id: actor.id,
    action,
    notes:    mapping.logMessage,
    metadata: { action, status: mapping.status },
  })

  return NextResponse.json({ ok: true, mission: updated })
}
