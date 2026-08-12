export const dynamic = 'force-dynamic'

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AppShell              from '@/components/layout/AppShell'
import { sessionAccess }     from '@/lib/access'
import ReconciliationClient  from './ReconciliationClient'

export default async function ReconciliationPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  // Rodage : superadmin STRICT, sur les trois surfaces (tuile Finance, page,
  // API). Ouvrir au module 'facturation' quand les écritures seront validées.
  const access = sessionAccess(session, { roles: ['superadmin'], modules: [] })
  if (!access.ok) redirect('/dashboard')

  const supabase = createAdminClient()
  const { data: userModulesDb } = await supabase
    .from('user_modules')
    .select('module_id')
    .eq('user_id', (session.user as any).id)
    .eq('granted', true)

  const modules = (userModulesDb || []).map(m => m.module_id)

  return (
    <AppShell
      title="Réconciliation"
      userRole={(session.user as any).role}
      userName={session.user.name ?? ''}
      userModules={modules}
    >
      <ReconciliationClient userName={session.user.name ?? ''} />
    </AppShell>
  )
}
