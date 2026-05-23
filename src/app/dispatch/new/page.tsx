// src/app/dispatch/new/page.tsx

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import NewMissionClient      from './NewMissionClient'

export default async function NewMissionPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].some(r =>
    (user.roles || [user.role]).includes(r)
  )
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const supabase = createAdminClient()

  const [{ data: drivers }, { data: warnings }, { data: catalogSources }] = await Promise.all([
    supabase.from('users').select('id, name').eq('active', true)
      .or('role.in.(driver,admin,superadmin),roles.ov.{driver,admin,superadmin}').order('name'),
    supabase.from('mission_warnings').select('id, label, icon, color')
      .eq('active', true).order('sort_order'),
    // Catalog central des sources : pas de hardcode cote client.
    // Toute source ajoutee dans /admin/sources apparait automatiquement ici.
    // Tri alphabetique par label (cohereent avec /admin/sources).
    supabase.from('mission_source_catalog').select('key, label').eq('active', true).order('label'),
  ])

  return (
    <NewMissionClient
      drivers={drivers || []}
      warnings={warnings || []}
      sources={catalogSources || []}
      userName={user.name || ''}
      userEmail={user.email || undefined}
      userId={user.id || undefined}
      userRole={user.role || ''}
      userModules={user.modules || []}
      googleMapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
    />
  )
}
