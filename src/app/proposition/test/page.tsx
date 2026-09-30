// Test des propositions de nuit sur son propre téléphone (Olivier 30/09/2026) :
// vraie notif, vrai appel avec le message vocal après 2 min, fin après 4 min.
// Aucune vraie mission, rien à la réserve ni au dispatcher.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AppShell              from '@/components/layout/AppShell'
import TestClient            from './TestClient'
import { toE164 }            from '@/lib/missions/market-proposals'

export const dynamic = 'force-dynamic'

export default async function PropositionTestPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const sb = createAdminClient()
  const [{ data: u }, { data: pers }] = await Promise.all([
    sb.from('users').select('phone').eq('id', user.id).maybeSingle(),
    sb.from('personnel').select('phone').eq('user_id', user.id).limit(1),
  ])
  const phone = toE164(u?.phone || pers?.[0]?.phone)
  return (
    <AppShell title="Tester la garde de nuit" userRole={user.role || ''} userName={user.name} userEmail={user.email} userId={user.id} userModules={user.modules || []}>
      <TestClient phoneEnd={phone ? phone.slice(-2) : null} />
    </AppShell>
  )
}
