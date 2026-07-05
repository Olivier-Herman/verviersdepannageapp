// src/lib/missions/load-fiche-props.ts
//
// Charge les données PAR mission nécessaires à MissionDetailClient (la fiche
// existante), pour pouvoir la ré-afficher telle quelle dans un groupe de la vue
// dossier. Réplique la logique de src/app/dispatch/[id]/page.tsx (sans les
// données partagées drivers/sources qui sont chargées une seule fois).

import { createAdminClient } from '@/lib/supabase'
import { ensureTouringDepartDepot } from '@/lib/depots/nearest'

export interface MissionFicheData {
  mission:            any
  logs:               any[]
  linkedParent:       any
  linkedChild:        any
  autoDispatchStatus: string | null
  parcZoneType:       string | null
}

export async function loadMissionFiche(missionId: string): Promise<MissionFicheData | null> {
  const supabase = createAdminClient()

  const { data: mission } = await supabase
    .from('incoming_missions')
    .select(`*, assigned_user:users!assigned_to(id, name, avatar_url)`)
    .eq('id', missionId)
    .single()
  if (!mission) return null

  await ensureTouringDepartDepot(supabase, mission)

  const { data: logs } = await supabase
    .from('mission_logs')
    .select('*, actor:users!actor_id(name)')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false })

  const { data: activeAttempt } = await supabase
    .from('dispatch_attempts_log')
    .select('driver_id, status, attempt_order, created_at, driver:users!dispatch_attempts_log_driver_id_fkey(name)')
    .eq('mission_id', missionId)
    .in('status', ['pending', 'push_sent', 'call_1_sent', 'call_2_sent'])
    .order('attempt_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  let autoDispatchStatus: string | null = null
  if (activeAttempt) {
    const driverName = (activeAttempt.driver as any)?.name || '?'
    switch (activeAttempt.status) {
      case 'pending':
      case 'push_sent':   autoDispatchStatus = `En cours d'assignation à ${driverName}`; break
      case 'call_1_sent': autoDispatchStatus = `Tentative d'appel à ${driverName}`;      break
      case 'call_2_sent': autoDispatchStatus = `2e tentative d'appel à ${driverName}`;   break
    }
  }

  let linkedParent: any = null
  let linkedChild:  any = null
  if ((mission as any).parent_mission_id) {
    const { data: parent } = await supabase
      .from('incoming_missions')
      .select('id, mission_number, external_id, dossier_number, status, vehicle_plate, completed_at, parked_at, destination_address, redelivery_address')
      .eq('id', (mission as any).parent_mission_id)
      .maybeSingle()
    linkedParent = parent
  }
  {
    const { data: child } = await supabase
      .from('incoming_missions')
      .select('id, mission_number, external_id, dossier_number, status, vehicle_plate, assigned_to, received_at, intervention_date')
      .eq('parent_mission_id', (mission as any).id)
      .not('status', 'in', '("cancelled","ignored")')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    linkedChild = child
  }

  let parcZoneType: string | null = null
  if ((mission as any).parc_zone_key) {
    const { data: pz } = await supabase
      .from('parc_zones')
      .select('zone_type')
      .eq('key', (mission as any).parc_zone_key)
      .maybeSingle()
    parcZoneType = (pz?.zone_type as string) || null
  }

  return { mission, logs: logs || [], linkedParent, linkedChild, autoDispatchStatus, parcZoneType }
}
