export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminFrancofoliesClient from './AdminFrancofoliesClient'

export default async function AdminFrancofoliesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'superadmin') redirect('/admin')

  const sb = createAdminClient()
  const { data: settings } = await sb.from('app_settings').select('key, value')
    .in('key', ['francofolies_price', 'francofolies_gardiennage_price'])
  const map = Object.fromEntries((settings || []).map(s => [s.key, s.value]))

  return (
    <AdminFrancofoliesClient
      userRole={session.user.role}
      userName={session.user.name || ''}
      userEmail={session.user.email || ''}
      price={Number(map.francofolies_price || 220)}
      gardiennage={Number(map.francofolies_gardiennage_price || 20)}
    />
  )
}
