// src/app/admin/garde-schedule/page.tsx
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import GardeScheduleClient   from './GardeScheduleClient'

export const dynamic = 'force-dynamic'

export default async function GardeSchedulePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard')

  const sb = createAdminClient()
  const { data: periods } = await sb
    .from('schedule_periods')
    .select('id, kind, hour_start, hour_end, cross_midnight, label, active, updated_at')
    .order('kind')

  return <GardeScheduleClient initialPeriods={periods || []} />
}
