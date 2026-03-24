import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import CheckDetailClient from './CheckDetailClient'
import AppShell from '@/components/layout/AppShell'
import { createAdminClient } from '@/lib/supabase'

export default async function CheckDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()
  const { data: userModulesDb } = await supabase
    .from('user_modules')
    .select('module_id')
    .eq('user_id', (session.user as any).id)
    .eq('granted', true)

  return (
    <AppShell
      title="Contrôle véhicule"
      userRole={(session.user as any).role}
      userName={session.user.name ?? ''}
      userModules={(userModulesDb || []).map(m => m.module_id)}
    >
      <CheckDetailClient checkId={params.id} session={session} />
    </AppShell>
  )
}
