export const dynamic = 'force-dynamic'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AppShell from '@/components/layout/AppShell'
import RapportClient from './RapportClient'

export default async function RapportCheckPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const { data: mods } = await createAdminClient().from('user_modules').select('module_id').eq('user_id', (session.user as any).id).eq('granted', true)
  return (
    <AppShell title="Rapport check véhicule" userRole={(session.user as any).role} userName={session.user.name ?? ''} userModules={(mods || []).map(m => m.module_id)}>
      <RapportClient id={params.id} />
    </AppShell>
  )
}
