// src/app/touring-comex/page.tsx
//
// Onglet « Touring COMEX » — rapprochement des dossiers COMEX BKO (auto-
// facturation Touring) avec les fiches VD Soft. SUPERADMIN uniquement (phase
// de test). Olivier 2026-07-27.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import TouringComexClient   from './TouringComexClient'

export const dynamic = 'force-dynamic'

export default async function TouringComexPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/touring-comex')
  const user = session.user as any
  if (user.role !== 'superadmin') redirect('/dashboard?error=access_denied')

  return (
    <TouringComexClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={user.modules || []}
    />
  )
}
