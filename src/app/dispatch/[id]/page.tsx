// src/app/dispatch/[id]/page.tsx

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import MissionDetailClient   from './MissionDetailClient'

export default async function MissionDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].some(r =>
    (user.roles || [user.role]).includes(r)
  )
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const supabase = createAdminClient()

  // Mission complète avec logs.
  // params.id accepte 2 formats :
  //   - UUID classique (xxx-xxx-xxx-...)
  //   - mission_number numerique (#10001234 sans le #) — Olivier 2026-05-26
  // On detecte via /^\d+$/ pour ne pas tenter une recherche UUID si numerique.
  const idIsNumeric = /^\d+$/.test(params.id)
  const baseQuery = supabase
    .from('incoming_missions')
    .select(`
      *,
      assigned_user:users!assigned_to(id, name, avatar_url)
    `)
  const { data: mission } = idIsNumeric
    ? await baseQuery.eq('mission_number', Number(params.id)).single()
    : await baseQuery.eq('id', params.id).single()

  if (!mission) redirect('/dispatch')

  // Logs de la mission
  const { data: logs } = await supabase
    .from('mission_logs')
    .select('*, actor:users!actor_id(name)')
    .eq('mission_id', params.id)
    .order('created_at', { ascending: false })

  // Auto-dispatch en cours (le plus recent attempt actif)
  const { data: activeAttempt } = await supabase
    .from('dispatch_attempts_log')
    .select('driver_id, status, attempt_order, created_at, driver:users!dispatch_attempts_log_driver_id_fkey(name)')
    .eq('mission_id', params.id)
    .in('status', ['pending', 'push_sent', 'call_1_sent', 'call_2_sent'])
    .order('attempt_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  let autoDispatchStatus: string | null = null
  if (activeAttempt) {
    const driverName = (activeAttempt.driver as any)?.name || '?'
    switch (activeAttempt.status) {
      case 'pending':
      case 'push_sent':
        autoDispatchStatus = `En cours d'assignation à ${driverName}`
        break
      case 'call_1_sent':
        autoDispatchStatus = `Tentative d'appel à ${driverName}`
        break
      case 'call_2_sent':
        autoDispatchStatus = `2e tentative d'appel à ${driverName}`
        break
    }
  }

  // Missions liees dans la chaine REM ↔ REL
  // - Si cette mission est une REL : charger la REM parente
  // - Si cette mission est une REM : chercher une REL enfant (parent_mission_id = cette mission)
  let linkedParent: any = null
  let linkedChild:  any = null
  if (mission.parent_mission_id) {
    const { data: parent } = await supabase
      .from('incoming_missions')
      .select('id, mission_number, external_id, dossier_number, status, vehicle_plate, completed_at, parked_at, destination_address, redelivery_address')
      .eq('id', mission.parent_mission_id)
      .maybeSingle()
    linkedParent = parent
  }
  {
    const { data: child } = await supabase
      .from('incoming_missions')
      .select('id, mission_number, external_id, dossier_number, status, vehicle_plate, assigned_to, received_at, intervention_date')
      .eq('parent_mission_id', mission.id)
      .maybeSingle()
    linkedChild = child
  }

  // Chauffeurs actifs + catalog sources (display_color, group_key)
  const [{ data: drivers }, { data: catalogSources }] = await Promise.all([
    supabase
      .from('users')
      .select('id, name, avatar_url')
      .eq('active', true)
      .or('role.in.(driver,admin,superadmin),roles.ov.{driver,admin,superadmin}')
      .order('name'),
    supabase
      .from('mission_source_catalog')
      .select('key, label, display_color, group_key')
      .eq('active', true)
      .order('label'),
  ])

  // Detection accès Odoo du user connecté (pour brancher la restitution
  // vers devis direct ou encaissement chauffeur)
  let userHasOdooAccess = false
  if (user.id) {
    const { data: meRow } = await supabase
      .from('users')
      .select('odoo_api_key')
      .eq('id', user.id)
      .maybeSingle()
    userHasOdooAccess = Boolean(meRow?.odoo_api_key)
  }

  return (
    <MissionDetailClient
      mission={mission}
      logs={logs || []}
      drivers={drivers || []}
      sources={catalogSources || []}
      linkedParent={linkedParent}
      linkedChild={linkedChild}
      userName={user.name || ''}
      userEmail={user.email || undefined}
      userId={user.id || undefined}
      userRole={user.role || ''}
      userModules={user.modules || []}
      userHasOdooAccess={userHasOdooAccess}
      googleMapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
      autoDispatchStatus={autoDispatchStatus}
    />
  )
}
