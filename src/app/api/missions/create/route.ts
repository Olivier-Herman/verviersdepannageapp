// src/app/api/missions/create/route.ts

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

  // Adresse principale = première destination
  const primaryIncident    = body.destinations?.[0]
  const primaryDestination = body.destinations?.[1]

  const { data: mission, error } = await supabase
    .from('incoming_missions')
    .insert({
      external_id:          `MAN_${Date.now()}`,
      source:               body.source              || 'prive',
      source_format:        'manual',
      source_email_id:      `manual_${Date.now()}`,
      mission_type:         body.mission_type,
      incident_type:        body.mission_type,       // DSP/REM/DPR/VR/Transport
      incident_description: body.remarks_general,
      // Client facturé
      billed_to_name:       body.billed_to_name,
      billed_to_id:         body.billed_to_id        || null,
      // Client assisté
      client_name:          body.assisted_name        || body.billed_to_name,
      client_phone:         body.assisted_phone,
      // Véhicule
      vehicle_plate:        body.vehicle_plate,
      vehicle_brand:        body.vehicle_brand,
      vehicle_model:        body.vehicle_model,
      vehicle_vin:          body.vehicle_vin,
      vehicle_fuel:         body.vehicle_fuel,
      vehicle_gearbox:      body.vehicle_gearbox,
      // Adresses (première = incident, deuxième = destination principale)
      incident_address:     primaryIncident?.address,
      incident_city:        primaryIncident?.city,
      incident_lat:         primaryIncident?.lat      || null,
      incident_lng:         primaryIncident?.lng      || null,
      incident_country:     'BE',
      destination_name:     primaryDestination?.label,
      destination_address:  primaryDestination?.address,
      // Toutes les destinations en jsonb
      destinations:         body.destinations         || [],
      // Avertissements
      warnings:             body.warnings             || [],
      // Remarques
      remarks_general:      body.remarks_general,
      remarks_billing:      body.remarks_billing,
      // RDV
      rdv_at:               body.rdv_at               || null,
      incident_at:          body.rdv_at               || now,
      received_at:          now,
      status:               'new',
      dispatch_mode:        'manual',
      parse_confidence:     1.0,
      parsed_data: {
        confidence:          1.0,
        created_manually_by: actor?.name,
        odoo_partner_id:     body.odoo_partner_id     || null,
        odoo_vehicle_id:     body.odoo_vehicle_id     || null,
        distance_km:         body.distance_km         || null,
        duration_min:        body.duration_min        || null,
      }
    })
    .select('id, external_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('mission_logs').insert({
    mission_id: mission.id,
    actor_id:   actor?.id || null,
    action:     'received',
    notes:      `Mission créée manuellement par ${actor?.name || 'dispatcher'}`,
    metadata:   { source: body.source, manual: true }
  })

  const typeLabel = body.mission_type === 'REM'       ? '🚛 Remorquage'
                  : body.mission_type === 'DSP'       ? '🔧 Dépannage'
                  : body.mission_type === 'Transport' ? '🚐 Transport'
                  : body.mission_type === 'DPR'       ? '📍 Déplacement vide'
                  : body.mission_type === 'VR'        ? '🚗 Véhicule remplacement'
                  : '📋 Mission'

  const vehicle = [body.vehicle_brand, body.vehicle_model, body.vehicle_plate]
    .filter(Boolean).join(' ')

  // Push warnings urgents si présents
  const warningPush = body.warnings?.length
    ? ` ⚠️ ${body.warnings.join(', ')}`
    : ''

  await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
    title: `${typeLabel} — ${(body.source || 'MANUEL').toUpperCase()}`,
    body:  (vehicle || body.assisted_name || body.billed_to_name || 'Nouvelle mission') + warningPush,
    url:   `/dispatch/${mission.id}`,
    tag:   `mission-${mission.id}`,
    icon:  '/icons/apple-touch-icon.png'
  })

  return NextResponse.json({ ok: true, mission_id: mission.id, external_id: mission.external_id })
}
