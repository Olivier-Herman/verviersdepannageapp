import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminGarageCancellationsClient from './AdminGarageCancellationsClient'

export const dynamic = 'force-dynamic'

export default async function AdminGarageCancellationsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string  = (session.user as any).role || ''
  const roles: string[] = Array.isArray((session.user as any).roles) ? (session.user as any).roles : []
  if (![role, ...roles].some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))) {
    redirect('/dashboard?error=access_denied')
  }

  const sb = createAdminClient()
  const { data } = await sb
    .from('garage_cancellation_requests')
    .select(`
      id, mission_id, requested_at, reason, status, decided_at, decision_note,
      garage_partners ( id, name ),
      incoming_missions ( id, mission_number, mission_type, vehicle_plate, vehicle_brand, vehicle_model, status, accepted_at, on_way_at )
    `)
    .order('requested_at', { ascending: false })
    .limit(100)

  return <AdminGarageCancellationsClient initialRequests={(data || []) as any} />
}
