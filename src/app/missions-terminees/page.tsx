// src/app/missions-terminees/page.tsx
//
// Page "Missions terminees" : vue unifiee de toutes les missions cloturees
// (a facturer, facturees, autofacturees, sans frais, annulees, archivees).
// Remplace l'ancien onglet "Termine" du dispatch qui s'engorgeait avec le temps.

import { getServerSession }   from 'next-auth'
import { redirect }           from 'next/navigation'
import { authOptions }        from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import MissionsTermineesClient from './MissionsTermineesClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function MissionsTermineesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('facturation') ||
    modules.includes('missions')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  // Catalog des sources (label + display_color) pour les helpers d'affichage
  const sb = createAdminClient()
  const { data: catalogSources } = await sb
    .from('mission_source_catalog')
    .select('key, label, display_color, group_key')
    .eq('active', true)
    .order('label')

  return (
    <MissionsTermineesClient
      catalogSources={catalogSources || []}
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userId={user.id || ''}
      userModules={modules}
    />
  )
}
