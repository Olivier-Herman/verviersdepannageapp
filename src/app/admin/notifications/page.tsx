import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import NotificationsClient   from './NotificationsClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function NotificationsAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const [{ data: users }, { data: prefs }] = await Promise.all([
    sb.from('users')
      .select('id, name, email, role, active')
      .eq('active', true)
      .order('role')
      .order('name'),
    sb.from('notification_preferences')
      .select('user_id, notif_type, enabled'),
  ])

  return (
    <NotificationsClient
      initialUsers={users || []}
      initialPrefs={prefs || []}
    />
  )
}
