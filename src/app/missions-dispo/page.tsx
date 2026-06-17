// Page Momo Market (ex Self-Service) : missions disponibles depuis < 15 min,
// non assignees. Le chauffeur clique "Je la prends" pour se l attribuer.
// Olivier 2026-06-02 : pas de notif push (le dispatch appelle le chauffeur).
// Olivier 2026-06-02 PM : renomme en "Momo Market" :-p

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
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  // Olivier 2026-06-17 : l'entrée de menu "Momo Market" est gated par le module
  // `driver_missions` (cf nav-items.ts), mais la garde de page ne testait QUE le
  // rôle → un chauffeur qui voyait le menu était renvoyé au dashboard. On aligne
  // la garde sur le module pour que menu et accès soient cohérents.
  const canAccess = allRoles.some(r => ['driver', 'chauffeur', 'admin', 'superadmin', 'dispatcher'].includes(r))
    || modules.includes('driver_missions')
    || modules.includes('missions')
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
    // Olivier 2026-06-17 : ne montrer QUE les missions correctement sourcées.
    // Les placeholders d'expéditeur inconnu (source 'unknown') ou les missions
    // en erreur de parsing n'ont pas de données exploitables → on les exclut de
    // l'étal (elles s'affichaient en "Unknown / Client").
    .neq('source', 'unknown')
    .gte('received_at', fifteenMinAgo)
    .order('received_at', { ascending: false })
    .limit(20)

  return (
    <AppShell
      title="Momo Market"
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
