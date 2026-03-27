// src/app/api/missions/list/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || 'new'
  const source = searchParams.get('source') || ''

  const supabase = createAdminClient()

  // Récupérer les missions
  let query = supabase
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, source, source_format,
      mission_type, incident_type, incident_description,
      client_name, client_phone,
      vehicle_plate, vehicle_brand, vehicle_model,
      incident_address, incident_city, incident_country,
      destination_name, destination_address,
      amount_guaranteed, incident_at, received_at,
      status, dispatch_mode,
      assigned_to, assigned_at, accepted_at,
      parse_confidence,
      assigned_user:users!assigned_to(id, name, avatar_url)
    `)
    .order('received_at', { ascending: false })
    .limit(100)

  // Filtrer les entrées parasites (corps vides, PROCESSING, etc.)
  query = query
    .not('external_id', 'like', 'PROCESSING_%')
    .not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gt.0.3')

  if (status === 'new') {
    query = query.eq('status', 'new')
  } else if (status === 'dispatching') {
    query = query.eq('status', 'dispatching')
  } else if (status === 'assigned') {
    query = query.in('status', ['assigned', 'accepted'])
  } else if (status === 'in_progress') {
    query = query.eq('status', 'in_progress')
  } else if (status === 'completed') {
    query = query.eq('status', 'completed')
  } else if (status === 'all') {
    query = query.not('status', 'in', '("parse_error","ignored")')
  }

  if (source) query = query.eq('source', source)

  const { data: missions, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Compteurs par statut
  const { data: counts } = await supabase
    .from('incoming_missions')
    .select('status')
    .not('external_id', 'like', 'PROCESSING_%')
    .not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gt.0.3')

  const counters = {
    new:         counts?.filter(m => m.status === 'new').length         || 0,
    dispatching: counts?.filter(m => m.status === 'dispatching').length || 0,
    assigned:    counts?.filter(m => ['assigned','accepted'].includes(m.status)).length || 0,
    in_progress: counts?.filter(m => m.status === 'in_progress').length || 0,
    completed:   counts?.filter(m => m.status === 'completed').length   || 0,
    errors:      counts?.filter(m => m.status === 'parse_error').length || 0,
  }

  return NextResponse.json({ missions, counters })
}
