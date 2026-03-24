export const dynamic = 'force-dynamic'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AppShell from '@/components/layout/AppShell'
import FinanceClient from './FinanceClient'

export default async function FinancePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()
  const { data: userModulesDb } = await supabase
    .from('user_modules')
    .select('module_id')
    .eq('user_id', (session.user as any).id)
    .eq('granted', true)

  const modules = (userModulesDb || []).map(m => m.module_id)

  return (
    <AppShell
      title="Finance"
      userRole={(session.user as any).role}
      userName={session.user.name ?? ''}
      userModules={modules}
    >
      <FinanceClient userModules={modules} />
    </AppShell>
  )
}
