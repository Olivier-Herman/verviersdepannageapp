// src/app/admin/tarifs-transport/page.tsx
// Grille transport / rapatriement : prix/km HTVA par source × gabarit.
// Olivier 21/09/2026 (grille par gabarit, préalable robot transports).
// Accès admin / superadmin (même gating que l'API /api/admin/transport-tariffs).

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import TarifsTransportClient from './TarifsTransportClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function TarifsTransportPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!sessionAccess(session).ok) redirect('/dashboard?error=access_denied')

  const user = session.user as any
  return (
    <TarifsTransportClient
      userRole={user.role || ''}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={user.modules || []}
    />
  )
}
