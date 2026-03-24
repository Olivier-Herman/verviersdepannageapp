import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminOrDispatcher } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToUser } from '@/lib/push'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdminOrDispatcher(session.user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const supabase = createAdminClient()

  const { data: userData } = await supabase
    .from('users').select('id, name').eq('email', session.user.email).single()
  if (!userData) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const { data: check } = await supabase
    .from('vehicle_checks')
    .select('*, vehicle:check_vehicles(id, name, plate, usual_driver_id)')
    .eq('id', params.id)
    .single()

  if (!check) return NextResponse.json({ error: 'Contrôle introuvable' }, { status: 404 })
  if (check.status !== 'pending_claim') {
    return NextResponse.json({ error: 'Ce contrôle a déjà été pris en charge.' }, { status: 409 })
  }

  // Mise à jour avec protection race condition (eq status)
  const { data: updated, error } = await supabase
    .from('vehicle_checks')
    .update({
      status:     'in_progress',
      claimed_by: userData.id,
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('status', 'pending_claim')
    .select('*, vehicle:check_vehicles(id, name, plate, usual_driver_id), claimed_by_user:users!vehicle_checks_claimed_by_fkey(id, name)')
    .single()

  if (error || !updated) {
    return NextResponse.json({ error: 'Ce contrôle vient d\'être pris en charge par quelqu\'un d\'autre.' }, { status: 409 })
  }

  // Push aux autres responsables
  const { data: setting } = await supabase
    .from('app_settings').select('value').eq('key', 'check_responsible_ids').single()
  const responsibleIds: string[] = setting ? JSON.parse(setting.value) : []
  const othersIds = responsibleIds.filter(id => id !== userData.id)

  for (const rid of othersIds) {
    await sendPushToUser(rid, {
      title: '✅ Contrôle pris en charge',
      body:  `${userData.name} prend en charge le contrôle du véhicule ${check.vehicle?.plate}.`,
    })
  }

  // Push au conducteur habituel
  if (check.vehicle?.usual_driver_id) {
    await sendPushToUser(check.vehicle.usual_driver_id, {
      title: '🚛 Contrôle véhicule',
      body:  `Le véhicule ${check.vehicle.plate} vient d'être sélectionné pour un contrôle. Merci de te présenter avec le véhicule, les documents et le matériel auprès de ${userData.name}.`,
    })

    await supabase
      .from('vehicle_checks')
      .update({ driver_notified_at: new Date().toISOString() })
      .eq('id', params.id)
  }

  return NextResponse.json({ check: updated })
}
