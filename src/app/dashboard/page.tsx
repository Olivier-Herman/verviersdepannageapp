import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()
  const { data: callShortcuts } = await supabase
    .from('call_shortcuts')
    .select('*')
    .eq('active', true)
    .order('sort_order')

  return <DashboardClient session={session} callShortcuts={callShortcuts || []} />
}
