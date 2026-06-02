import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminPoliceZonesClient from './AdminPoliceZonesClient'

export const dynamic = 'force-dynamic'

export default async function AdminPoliceZonesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const { data: zones } = await sb
    .from('police_zones')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  return <AdminPoliceZonesClient initialZones={zones || []} />
}
