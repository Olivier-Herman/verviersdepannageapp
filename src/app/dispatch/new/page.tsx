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
  const { data: drivers } = await supabase
    .from('users')
    .select('id, name')
    .eq('active', true)
    .in('role', ['driver', 'admin', 'superadmin'])
    .order('name')

  return (
    <NewMissionClient
      drivers={drivers || []}
      userName={user.name || ''}
      userRole={user.role || ''}
      googleMapsKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
    />
  )
}
