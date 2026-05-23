// src/app/dispatch/page.tsx

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import DispatchClient       from './DispatchClient'

export default async function DispatchPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].some(r =>
    (user.roles || [user.role]).includes(r)
  )
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const supabase = createAdminClient()
  // Chauffeurs + catalog sources (display_color, group_key) en parallele
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

  return (
    <DispatchClient
      drivers={drivers || []}
      sources={catalogSources || []}
      userName={user.name || ''}
      userEmail={user.email || undefined}
      userId={user.id || undefined}
      userRole={user.role || ''}
      userModules={user.modules || []}
    />
  )
}
