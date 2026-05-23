import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import ArchivesClient        from './ArchivesClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function ArchivesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) redirect('/dashboard?error=access_denied')

  // Catalog des sources (label + display_color) pour les helpers d'affichage
  const sb = createAdminClient()
  const { data: catalogSources } = await sb
    .from('mission_source_catalog')
    .select('key, label, display_color, group_key')
    .eq('active', true)
    .order('label')

  return <ArchivesClient catalogSources={catalogSources || []} />
}
