import { getServerSession }  from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import AutoDispatchResponseClient from './AutoDispatchResponseClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function AutoDispatchPage({ params }: { params: { attemptId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const userId = (session.user as any).id

  const sb = createAdminClient()
  const { data: attempt } = await sb
    .from('dispatch_attempts_log')
    .select(`
      id, mission_id, driver_id, attempt_order, status,
      mission:incoming_missions(id, dossier_number, source, mission_type, incident_address, incident_city, destination_address, destination_name, client_name, vehicle_plate, vehicle_brand, vehicle_model)
    `)
    .eq('id', params.attemptId)
    .maybeSingle()

  if (!attempt) notFound()
  if (attempt.driver_id !== userId) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h1 className="text-ink text-xl font-semibold mb-2">⛔ Pas pour toi</h1>
        <p className="text-ink-muted text-sm">Cette mission est proposée à un autre chauffeur.</p>
      </div>
    )
  }
  if (['accepted', 'refused', 'unavailable', 'timeout', 'skipped'].includes(attempt.status)) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h1 className="text-ink text-xl font-semibold mb-2">⏰ Trop tard</h1>
        <p className="text-ink-muted text-sm">Cette proposition est déjà clôturée (statut : {attempt.status}).</p>
      </div>
    )
  }

  // Le chauffeur est-il en mission actuellement ? (pour afficher boutons "Dispo dans X min")
  const { data: activeMissions } = await sb
    .from('incoming_missions')
    .select('id')
    .eq('assigned_to', userId)
    .in('status', ['assigned', 'accepted', 'on_way', 'on_site', 'in_progress'])
    .neq('id', attempt.mission_id)
    .limit(1)
  const isInMission = (activeMissions?.length || 0) > 0

  return (
    <AutoDispatchResponseClient
      attemptId={attempt.id}
      mission={attempt.mission as any}
      isInMission={isInMission}
    />
  )
}
