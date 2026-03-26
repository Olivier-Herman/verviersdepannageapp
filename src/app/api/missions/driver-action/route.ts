// src/app/api/missions/driver-action/route.ts
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

type DriverAction = 'accept' | 'on_way' | 'on_site' | 'completed'

const ACTION_MAP: Record<DriverAction, {
  status?: string
  timestampField: string
  logMessage: string
}> = {
  accept: {
    status:         'accepted',
    timestampField: 'accepted_at',
    logMessage:     'Mission acceptée par le chauffeur',
  },
  on_way: {
    status:         'in_progress',
    timestampField: 'on_way_at',
    logMessage:     'Chauffeur en route',
  },
  on_site: {
    timestampField: 'on_site_at',
    logMessage:     'Chauffeur sur place',
  },
  completed: {
    status:         'completed',
    timestampField: 'completed_at',
    logMessage:     'Mission terminée',
  },
}

// Transitions autorisées
const ALLOWED: Record<string, DriverAction[]> = {
  assigned:    ['accept'],
  accepted:    ['on_way'],
  in_progress: ['on_site', 'completed'],
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mission_id, action, closing_data } = await req.json() as {
    mission_id:   string
    action:       DriverAction
    closing_data?: {
      payment_method?: string
      amount?:         number
      notes?:          string
    }
  }

  if (!mission_id || !action || !ACTION_MAP[action]) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Résoudre l'acteur depuis l'email de session
  const { data: actor } = await supabase
    .from('users')
    .select('id')
    .eq('email', session.user.email!)
    .single()

  if (!actor) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 })

  // Récupérer la mission
  const { data: mission, error: fetchError } = await supabase
    .from('incoming_missions')
    .select('id, status, assigned_to')
    .eq('id', mission_id)
    .single()

  if (fetchError || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  // Vérifier que c'est bien le chauffeur assigné
  if (mission.assigned_to !== actor.id) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Vérifier la transition
  const allowed = ALLOWED[mission.status] ?? []
  if (!allowed.includes(action)) {
    return NextResponse.json(
      { error: `Action '${action}' non permise depuis le statut '${mission.status}'` },
      { status: 422 }
    )
  }

  const mapping = ACTION_MAP[action]
  const now     = new Date().toISOString()

  const updatePayload: Record<string, unknown> = {
    [mapping.timestampField]: now,
    updated_at: now,
  }
  if (mapping.status) updatePayload.status = mapping.status

  // Données de clôture
  if (action === 'completed' && closing_data) {
    if (closing_data.payment_method) updatePayload.payment_method  = closing_data.payment_method
    if (closing_data.amount != null)  updatePayload.amount_collected = closing_data.amount
    if (closing_data.notes)           updatePayload.closing_notes   = closing_data.notes
  }

  const { data: updated, error: updateError } = await supabase
    .from('incoming_missions')
    .update(updatePayload)
    .eq('id', mission_id)
    .select()
    .single()

  if (updateError) {
    console.error('[driver-action] update error:', updateError)
    return NextResponse.json({ error: 'Erreur mise à jour' }, { status: 500 })
  }

  await supabase.from('mission_logs').insert({
    mission_id,
    actor_id: actor.id,
    action,
    notes:    mapping.logMessage,
    metadata: { action, status: mapping.status ?? mission.status },
  })

  return NextResponse.json({ ok: true, mission: updated })
}
