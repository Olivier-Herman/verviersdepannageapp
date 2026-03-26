// src/app/api/missions/driver-create/route.ts
// Création de mission par un chauffeur — status accepted direct, assigned à lui-même

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
      source:           source        || 'prive',
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
      status:           'accepted',
      dispatch_mode:    'manual',
      assigned_to:      session.user.id,
      assigned_at:      now,
      accepted_at:      now,
      received_at:      now,
      created_at:       now,
      updated_at:       now,
    })
    .select('id, external_id, status')
    .single()

  if (error) {
    console.error('[DriverCreate]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log
  await supabase.from('mission_logs').insert({
    mission_id: data.id,
    user_id:    session.user.id,
    action:     'driver_created',
    details:    { source, mission_type, incident_address },
  }).maybeSingle()

  return NextResponse.json({ ok: true, mission: data })
}
