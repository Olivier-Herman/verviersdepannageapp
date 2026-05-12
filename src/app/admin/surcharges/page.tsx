// src/app/admin/surcharges/page.tsx

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import SurchargesClient      from './SurchargesClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function SurchargesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const [{ data: clients }, { data: schedules }] = await Promise.all([
    sb.from('surcharge_clients').select('*').order('kind').order('sort_order').order('label'),
    sb.from('surcharge_schedules').select('*'),
  ])

  return (
    <SurchargesClient
      initialClients={clients || []}
      initialSchedules={schedules || []}
    />
  )
}
