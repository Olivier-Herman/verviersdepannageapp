// src/app/api/missions/assign/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToUser }    from '@/lib/push'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mission_id, driver_id } = await req.json()
  if (!mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const supabase = createAdminClient()

  // Récupérer les infos de la mission
  const { data: mission, error: mErr } = await supabase
    .from('incoming_missions')
    .select('id, external_id, source, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_address, incident_city')
    .eq('id', mission_id)
    .single()

  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Résoudre l'acteur
  const { data: actor } = await supabase
    .from('users')
    .select('id')
    .eq('email', session.user.email!)
    .single()

  const now = new Date().toISOString()

  if (driver_id) {
    // Assigner à un chauffeur
    const { data: driver } = await supabase
      .from('users')
      .select('id, name')
      .eq('id', driver_id)
      .single()

    await supabase
      .from('incoming_missions')
      .update({
        status:      'assigned',
        assigned_to: driver_id,
        assigned_at: now,
      })
      .eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id:  actor?.id || null,
      action:    'dispatched',
      notes:     `Assigné à ${driver?.name}`,
      metadata:  { driver_id, driver_name: driver?.name }
    })

    // Notifier le chauffeur
    const typeLabel    = mission.mission_type === 'remorquage' ? '🚛 Remorquage'
                       : mission.mission_type === 'depannage'  ? '🔧 Dépannage'
                       : '📋 Mission'
    const vehicleLabel = [mission.vehicle_brand, mission.vehicle_model, mission.vehicle_plate]
      .filter(Boolean).join(' ')

    await sendPushToUser(driver_id, {
      title: `${typeLabel} — ${mission.source.toUpperCase()}`,
      body:  `${vehicleLabel} — ${mission.incident_city || mission.incident_address || ''}`,
      url:   `/missions/${mission_id}`,
      tag:   `mission-assigned-${mission_id}`,
    })

    return NextResponse.json({ ok: true, status: 'assigned', driver_name: driver?.name })

  } else {
    // Retirer l'assignation (retour à new)
    await supabase
      .from('incoming_missions')
      .update({ status: 'new', assigned_to: null, assigned_at: null })
      .eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id: actor?.id || null,
      action:   'reassigned',
      notes:    'Assignation retirée',
    })

    return NextResponse.json({ ok: true, status: 'new' })
  }
}
