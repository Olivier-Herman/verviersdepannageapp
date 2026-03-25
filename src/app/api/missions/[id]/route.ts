// src/app/api/missions/[id]/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

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

  // Champs éditables depuis le formulaire de complétion
  const allowed = [
    'mission_type', 'incident_type', 'incident_description',
    'client_name', 'client_phone', 'client_address',
    'vehicle_plate', 'vehicle_brand', 'vehicle_model', 'vehicle_vin',
    'vehicle_fuel', 'vehicle_gearbox',
    'incident_address', 'incident_city', 'incident_country',
    'destination_name', 'destination_address',
    'amount_guaranteed', 'incident_at',
  ]

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await supabase
    .from('incoming_missions')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mission: data })
}
