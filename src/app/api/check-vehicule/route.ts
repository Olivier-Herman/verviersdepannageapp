import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminOrDispatcher } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: userData } = await supabase
    .from('users').select('id').eq('email', session.user.email).single()
  if (!userData) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const isAdmin = isAdminOrDispatcher(session.user)

  const baseQuery = () => supabase
    .from('vehicle_checks')
    .select(`
      *,
      vehicle:check_vehicles(id, name, plate, usual_driver_id),
      triggered_by_user:users!vehicle_checks_triggered_by_fkey(id, name),
      claimed_by_user:users!vehicle_checks_claimed_by_fkey(id, name)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  let checks: any[] = []

  if (isAdmin) {
    const { data } = await baseQuery()
    checks = data || []
  } else {
    // Driver: véhicules dont il est conducteur habituel
    const { data: driverVehicles } = await supabase
      .from('check_vehicles').select('id').eq('usual_driver_id', userData.id)
    const vehicleIds = (driverVehicles || []).map(v => v.id)
    if (vehicleIds.length > 0) {
      const { data } = await baseQuery().in('vehicle_id', vehicleIds)
      checks = data || []
    }
  }

  // Check actif (in_progress) pour le driver → bannière orange
  let activeCheck = null
  if (!isAdmin) {
    const { data: driverVehicles } = await supabase
      .from('check_vehicles').select('id').eq('usual_driver_id', userData.id)
    const vehicleIds = (driverVehicles || []).map(v => v.id)
    if (vehicleIds.length > 0) {
      const { data } = await supabase
        .from('vehicle_checks')
        .select('*, vehicle:check_vehicles(name, plate), claimed_by_user:users!vehicle_checks_claimed_by_fkey(name)')
        .in('vehicle_id', vehicleIds)
        .eq('status', 'in_progress')
        .limit(1)
        .maybeSingle()
      activeCheck = data || null
    }
  }

  return NextResponse.json({ checks, activeCheck })
}
