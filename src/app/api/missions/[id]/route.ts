// src/app/api/missions/[id]/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToUser }    from '@/lib/push'
import { updateOdooDossierForMission } from '@/lib/missions/odoo-dossier'

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: mission, error } = await supabase
    .from('incoming_missions')
    .select(`
      *,
      assigned_user:users!assigned_to(id, name, avatar_url),
      logs:mission_logs(id, action, notes, created_at, actor:users!actor_id(name))
    `)
    .eq('id', params.id)
    .single()

  if (error || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  return NextResponse.json({ mission })
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const supabase = createAdminClient()

  const allowed = [
    'mission_type', 'incident_type', 'incident_description',
    'billed_to_name', 'billed_to_id',
    'odoo_vehicle_id',
    'client_name', 'client_phone', 'client_address',
    'assisted_name', 'assisted_phone',
    'vehicle_plate', 'vehicle_brand', 'vehicle_model', 'vehicle_vin',
    'vehicle_fuel', 'vehicle_gearbox', 'vehicle_mileage',
    'incident_address', 'incident_city', 'incident_country',
    'incident_lat', 'incident_lng',
    'incident_borne_km', 'incident_sens',
    'destination_name', 'destination_address',
    'destination_lat', 'destination_lng',
    'destination_borne_km', 'destination_sens',
    'depot_depart_id',
    'extra_addresses',
    'amount_guaranteed', 'amount_to_collect', 'amount_currency',
    'incident_at', 'remarks_general',
  ]

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) {
      // Convertir les strings vides en null pour les champs numériques
      if (['amount_guaranteed', 'amount_to_collect', 'incident_lat', 'incident_lng', 'destination_lat', 'destination_lng', 'billed_to_id', 'odoo_vehicle_id'].includes(key)) {
        updates[key] = body[key] === '' || body[key] == null ? null : Number(body[key]) || null
      } else {
        updates[key] = body[key] === '' ? null : body[key]
      }
    }
  }

  const { data, error } = await supabase
    .from('incoming_missions')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notification push au chauffeur si demandé (modifications dispatcher après assignation).
  // Ne pas spammer pour les changements automatiques (ping silencieux d'adresse, etc).
  if (body._notify_driver && data.assigned_to) {
    sendPushToUser(data.assigned_to, {
      title: '✏️ Mission modifiée',
      body:  `${data.client_name || 'Mission'} — vérifie les nouvelles infos`,
      url:   `/mission/${params.id}`,
      tag:   `mission-updated-${params.id}`,
    }).catch(() => {})
  }

  // Sync vers Odoo (helpdesk + task) : pousse les modifs dispatcher.
  // No-op si pas encore de dossier Odoo créé. Best effort, non bloquant.
  if (body._notify_driver) {
    updateOdooDossierForMission(params.id).catch(e => {
      console.error('[Mission PATCH] Sync Odoo échoué:', e.message)
    })
  }

  return NextResponse.json({ ok: true, mission: data })
}
