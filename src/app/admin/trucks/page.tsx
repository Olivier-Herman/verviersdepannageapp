// /admin/trucks : CRUD des depanneuses.
// Olivier 2026-06-01. Reserve admin/superadmin.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminTrucksClient     from './AdminTrucksClient'

export const dynamic = 'force-dynamic'

export default async function AdminTrucksPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const [trucksRes, driversRes] = await Promise.all([
    sb.from('trucks')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    sb.from('users')
      .select('id, name, email, role, default_truck_id, current_truck_id')
      .or('role.in.(driver,dispatcher,admin,superadmin),roles.ov.{driver,dispatcher,admin,superadmin}')
      .eq('active', true)
      .order('name'),
  ])

  return <AdminTrucksClient
    initialTrucks={trucksRes.data || []}
    initialDrivers={driversRes.data || []}
  />
}
