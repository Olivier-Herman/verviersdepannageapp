// src/app/stats/page.tsx

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import StatsClient           from './StatsClient'

export const dynamic = 'force-dynamic'

export default async function StatsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('stats')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  // Catalog des sources (display_color_hex pour Recharts)
  const sb = createAdminClient()
  const { data: catalogSources } = await sb
    .from('mission_source_catalog')
    .select('key, label, display_color, display_color_hex, group_key')
    .eq('active', true)
    .order('label')

  return (
    <StatsClient
      catalogSources={catalogSources || []}
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
      userId={user.id}
    />
  )
}
