// src/app/api/missions/create/route.ts
// Création manuelle d'une mission depuis /dispatch/new

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToRole }    from '@/lib/push'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const supabase = createAdminClient()

  const { data: actor } = await supabase
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()

  const now = new Date().toISOString()

  const { data: mission, error } = await supabase
    .from('incoming_missions')
    .insert({
      external_id:          `MAN_${Date.now()}`,
      source:               body.source         || 'prive',
      source_format:        'manual',
      source_email_id:      `manual_${Date.now()}`,
      mission_type:         body.mission_type,
      incident_type:        body.incident_type,
      incident_description: body.incident_description,
      client_name:          body.client_name,
      client_phone:         body.client_phone,
      client_address:       body.client_address,
      vehicle_plate:        body.vehicle_plate,
      vehicle_brand:        body.vehicle_brand,
      vehicle_model:        body.vehicle_model,
      vehicle_vin:          body.vehicle_vin,
      vehicle_fuel:         body.vehicle_fuel,
      vehicle_gearbox:      body.vehicle_gearbox,
      incident_address:     body.incident_address,
      incident_city:        body.incident_city,
      incident_country:     body.incident_country || 'BE',
      incident_lat:         body.incident_lat,
      incident_lng:         body.incident_lng,
      destination_name:     body.destination_name,
      destination_address:  body.destination_address,
      destination_lat:      body.destination_lat,
      destination_lng:      body.destination_lng,
      amount_guaranteed:    body.amount_guaranteed || null,
      incident_at:          body.incident_at || now,
      received_at:          now,
      status:               'new',
      dispatch_mode:        'manual',
      parse_confidence:     1.0,
      parsed_data: {
        confidence:           1.0,
        created_manually_by:  actor?.name,
        odoo_partner_id:      body.odoo_partner_id   || null,
        odoo_vehicle_id:      body.odoo_vehicle_id   || null,
        distance_km:          body.distance_km       || null,
        duration_min:         body.duration_min      || null,
      }
    })
    .select('id, external_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log création
  await supabase.from('mission_logs').insert({
    mission_id: mission.id,
    actor_id:   actor?.id || null,
    action:     'received',
    notes:      `Mission créée manuellement par ${actor?.name || 'dispatcher'}`,
    metadata:   { source: body.source, manual: true }
  })

  // Push dispatchers
  const typeLabel = body.mission_type === 'remorquage' ? '🚛 Remorquage'
                  : body.mission_type === 'depannage'  ? '🔧 Dépannage'
                  : '📋 Mission'
  const vehicle   = [body.vehicle_brand, body.vehicle_model, body.vehicle_plate].filter(Boolean).join(' ')

  await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
    title: `${typeLabel} — ${(body.source || 'MANUEL').toUpperCase()}`,
    body:  vehicle || body.client_name || 'Nouvelle mission manuelle',
    url:   `/dispatch/${mission.id}`,
    tag:   `mission-${mission.id}`,
    icon:  '/icons/apple-touch-icon.png'
  })

  return NextResponse.json({ ok: true, mission_id: mission.id, external_id: mission.external_id })
}
