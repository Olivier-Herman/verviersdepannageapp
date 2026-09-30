export const dynamic = 'force-dynamic'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AppShell from '@/components/layout/AppShell'
import { isReportViewer } from '@/lib/truck-checks/server'
import AnomaliesClient from './AnomaliesClient'

// Anomalies à traiter (Olivier 30/09/2026) : admins, dispatchers, responsables des contrôles.
export default async function AnomaliesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u: any = session.user
  const sb = createAdminClient()
  if (!(await isReportViewer(sb, { id: u.id, role: u.role, roles: u.roles }))) redirect('/check-vehicule')
  const { data: mods } = await sb.from('user_modules').select('module_id').eq('user_id', u.id).eq('granted', true)
  return (
    <AppShell title="Anomalies à traiter" userRole={u.role} userName={session.user.name ?? ''} userModules={(mods || []).map(m => m.module_id)}>
      <AnomaliesClient />
    </AppShell>
  )
}
