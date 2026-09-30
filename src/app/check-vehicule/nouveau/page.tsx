export const dynamic = 'force-dynamic'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AppShell from '@/components/layout/AppShell'
import NouveauCheckClient from './NouveauCheckClient'

// Check camion par le chauffeur (Olivier 30/09/2026).
export default async function NouveauCheckPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const { data: mods } = await createAdminClient().from('user_modules').select('module_id').eq('user_id', (session.user as any).id).eq('granted', true)
  return (
    <AppShell title="Check véhicule" userRole={(session.user as any).role} userName={session.user.name ?? ''} userModules={(mods || []).map(m => m.module_id)}>
      <NouveauCheckClient />
    </AppShell>
  )
}
