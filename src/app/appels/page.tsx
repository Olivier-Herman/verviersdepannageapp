// src/app/appels/page.tsx — « Appels à rattacher » (Olivier 24/11/2026) : appels Teams des 48 dernières heures dont le
// numéro ne désigne pas une seule fiche. Bureau (mêmes droits que la fiche du dispatch). Cf src/lib/appels-fiches.ts.
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import AppShell from '@/components/layout/AppShell'
import { peutVoirAppels } from '@/lib/appels-fiches'
import AppelsClient from './AppelsClient'

export const dynamic = 'force-dynamic'

export default async function AppelsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/appels')
  const u = session.user as any
  if (!peutVoirAppels(u)) redirect('/dashboard?error=access_denied')
  return (
    <AppShell title="Appels à rattacher" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role || ''} userModules={u.modules || []}>
      <AppelsClient />
    </AppShell>
  )
}
