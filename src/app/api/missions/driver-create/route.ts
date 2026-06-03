// src/app/api/missions/driver-create/route.ts
// Missions créées par le chauffeur terrain.
// Status: in_progress → apparaît dans l'onglet "En cours" du dispatch en temps réel.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    source, mission_type, incident_address, incident_city,
    incident_lat, incident_lng,
    vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
    remarks_general,
  } = body

  if (!mission_type)     return NextResponse.json({ error: 'Type de mission requis' }, { status: 400 })
  if (!incident_address) return NextResponse.json({ error: "Adresse d'incident requise" }, { status: 400 })

  const now      = new Date().toISOString()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('incoming_missions')
    .insert({
      external_id:      `TERRAIN-${Date.now()}`,
      source:           source         || 'prive',
      mission_type,
      incident_address,
      incident_city:    incident_city  || null,
      incident_lat:     incident_lat   || null,
      incident_lng:     incident_lng   || null,
      vehicle_plate:    vehicle_plate  || null,
      vehicle_brand:    vehicle_brand  || null,
      vehicle_model:    vehicle_model  || null,
      vehicle_vin:      vehicle_vin    || null,
      remarks_general:  remarks_general|| null,
      // Le chauffeur crée + accepte + est déjà en route → in_progress
      // Apparaît dans l'onglet "En cours" du dispatch
      status:           'in_progress',
      dispatch_mode:    'manual',
      assigned_to:      session.user.id,
      assigned_at:      now,
      accepted_at:      now,
      on_way_at:        now,
      received_at:      now,
      intervention_date: now,
      created_at:       now,
      updated_at:       now,
    })
    .select('id, external_id, status')
    .single()

  if (error) {
    console.error('[DriverCreate]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log — Olivier 2026-06-03 : bug audit. La table mission_logs utilise
  // actor_id (uuid) + notes (text), pas user_id + details (jsonb). L INSERT
  // plantait silencieusement -> aucun log pour les missions creees chauffeur.
  const { error: logErr } = await supabase.from('mission_logs').insert({
    mission_id: data.id,
    actor_id:   session.user.id,
    action:     'driver_created',
    notes:      `Source=${source}, type=${mission_type}, lieu=${incident_address}`,
    metadata:   { source, mission_type, incident_address },
  })
  if (logErr) {
    console.error('[DriverCreate] mission_logs insert echec:', logErr.message)
    // Non bloquant : la mission est creee, juste le log manque
  }

  return NextResponse.json({ ok: true, mission: data })
}
