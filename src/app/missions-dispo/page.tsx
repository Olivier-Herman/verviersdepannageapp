// Page Self-Service : missions disponibles depuis < 15 min, non assignees.
// Le chauffeur clique "Je la prends" pour se l attribuer.
// Olivier 2026-06-02 : pas de notif push (le dispatch appelle le chauffeur).

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AppShell              from '@/components/layout/AppShell'
import SelfServiceClient     from './SelfServiceClient'

export const dynamic = 'force-dynamic'

export default async function MissionsDispoPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const role   = user.role || ''
  const roles: string[] = Array.isArray(user.roles) ? user.roles : []
  const allRoles = [role, ...roles].filter(Boolean)
  const canAccess = allRoles.some(r => ['driver', 'chauffeur', 'admin', 'superadmin', 'dispatcher'].includes(r))
  if (!canAccess) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: missions } = await sb
    .from('incoming_missions')
    .select(`
      id, mission_number, source, mission_type, status,
      vehicle_plate, vehicle_brand, vehicle_model,
      incident_address, incident_city,
      client_name, received_at, remarks_general
    `)
    .eq('status', 'new')
    .is('assigned_to', null)
    .neq('source', 'garage')
    .gte('received_at', fifteenMinAgo)
    .order('received_at', { ascending: false })
    .limit(20)

  return (
    <AppShell
      title="Missions disponibles"
      userRole={role}
      userName={user.name}
      userEmail={user.email}
      userId={user.id}
      userModules={user.modules || []}
    >
      <SelfServiceClient initialMissions={(missions || []) as any} currentUserId={user.id} />
    </AppShell>
  )
}
