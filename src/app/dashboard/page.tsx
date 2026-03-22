import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()

  // Charger les modules depuis Supabase en temps réel (pas depuis le JWT en cache)
  const { data: userModulesDb } = await supabase
    .from('user_modules')
    .select('module_id, granted')
    .eq('user_id', (session.user as any).id)
    .eq('granted', true)

  const liveModules = (userModulesDb || []).map(m => m.module_id)

  const { data: callShortcuts } = await supabase
    .from('call_shortcuts')
    .select('*')
    .eq('active', true)
    .order('sort_order')

  // Injecter les modules live dans la session
  const sessionWithLiveModules = {
    ...session,
    user: { ...session.user, modules: liveModules }
  }

  return <DashboardClient session={sessionWithLiveModules} callShortcuts={callShortcuts || []} />
}
