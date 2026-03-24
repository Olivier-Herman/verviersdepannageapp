import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminOrDispatcher } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToUser } from '@/lib/push'

function getRandomScheduledDate(): string {
  const today = new Date()
  const candidates: Date[] = []
  for (let i = 1; i <= 14 && candidates.length < 3; i++) {
    const d   = new Date(today)
    d.setDate(today.getDate() + i)
    const day = d.getDay() // 2=Mar, 3=Mer, 4=Jeu
    if (day >= 2 && day <= 4) candidates.push(d)
  }
  const chosen = candidates[Math.floor(Math.random() * candidates.length)]
  return chosen.toISOString().split('T')[0]
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdminOrDispatcher(session.user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const supabase = createAdminClient()

  // Vérifier qu'il n'y a pas déjà un check non terminé
  const { data: openCheck } = await supabase
    .from('vehicle_checks')
    .select('id, status, scheduled_date, vehicle:check_vehicles(name, plate)')
    .not('status', 'eq', 'completed')
    .limit(1)
    .maybeSingle()

  if (openCheck) {
    return NextResponse.json(
      { error: 'Un contrôle est déjà en cours ou planifié.', existing: openCheck },
      { status: 409 }
    )
  }

  const { data: userData } = await supabase
    .from('users').select('id, name').eq('email', session.user.email).single()
  if (!userData) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const { data: vehicles } = await supabase
    .from('check_vehicles').select('id, name, plate, usual_driver_id').eq('active', true)

  if (!vehicles || vehicles.length === 0) {
    return NextResponse.json({ error: 'Aucun véhicule actif configuré dans les paramètres.' }, { status: 400 })
  }

  const { data: lastCheck } = await supabase
    .from('vehicle_checks').select('vehicle_id').order('created_at', { ascending: false })
    .limit(1).maybeSingle()

  let candidates = vehicles
  if (lastCheck?.vehicle_id && vehicles.length > 1) {
    candidates = vehicles.filter(v => v.id !== lastCheck.vehicle_id)
  }

  const vehicle       = candidates[Math.floor(Math.random() * candidates.length)]
  const today         = new Date().toISOString().split('T')[0]

  // Tirage manuel → déclenchement immédiat (pending_claim + push maintenant)
  const { data: newCheck, error } = await supabase
    .from('vehicle_checks')
    .insert({
      triggered_by:   userData.id,
      vehicle_id:     vehicle.id,
      scheduled_date: today,
      status:         'pending_claim',
    })
    .select('*, vehicle:check_vehicles(id, name, plate, usual_driver_id)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Push immédiat à tous les responsables
  const { data: setting } = await supabase
    .from('app_settings').select('value').eq('key', 'check_responsible_ids').maybeSingle()
  const responsibleIds: string[] = setting ? JSON.parse(setting.value) : []

  for (const rid of responsibleIds) {
    await sendPushToUser(rid, {
      title: '🔍 Contrôle véhicule à prendre en charge',
      body:  `Contrôle déclenché maintenant : ${vehicle.name} (${vehicle.plate}). Ouvrez l'app pour le prendre en charge.`,
      url:   `${process.env.NEXT_PUBLIC_APP_URL}/check-vehicule/${newCheck.id}`,
    })
  }

  return NextResponse.json({ check: newCheck, vehicle, scheduledDate: today, immediate: true })
}
