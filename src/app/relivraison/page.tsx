// src/app/relivraison/page.tsx
//
// Module Relivraison — file des véhicules en parc en attente de relivraison
// (zone K), triés par tournée. Olivier 2026-06-22 : nouveau module placé sous
// Dispatch ; remplacera à terme l'onglet « À relivrer » du dispatch.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import RelivraisonClient     from './RelivraisonClient'

export const dynamic = 'force-dynamic'

export default async function RelivraisonPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const role: string      = user.role || ''
  const modules: string[] = user.modules || []
  // Olivier 2026-06-22 : module en construction → superadmin uniquement.
  if (role !== 'superadmin') redirect('/dashboard?error=access_denied')

  return (
    <RelivraisonClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email || undefined}
      userModules={modules}
    />
  )
}
