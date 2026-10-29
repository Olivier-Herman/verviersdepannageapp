// /mission/en-pause — missions remises au dispatch en pause, que tout chauffeur peut reprendre (Olivier 29/10/2026).
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import AppShell from '@/components/layout/AppShell'
import EnPauseClient from './EnPauseClient'

export const dynamic = 'force-dynamic'

export default async function EnPausePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/login')
  const { data: user } = await createAdminClient().from('users').select('id, name, role').eq('email', session.user.email).maybeSingle()
  if (!user) redirect('/dashboard')
  return (
    <AppShell title="Missions en pause" userRole={user.role ?? ''} userName={user.name ?? ''} userModules={(session.user as any).modules ?? []}>
      <EnPauseClient />
    </AppShell>
  )
}
