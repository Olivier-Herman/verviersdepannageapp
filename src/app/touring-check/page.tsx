// src/app/touring-check/page.tsx
// Module « Check Touring » — dossiers Touring hors comex à faire trancher.
// SUPERADMIN uniquement.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import TouringCheckAdminClient from './TouringCheckAdminClient'

export const dynamic = 'force-dynamic'

export default async function TouringCheckPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/touring-check')
  const user = session.user as any
  if (user.role !== 'superadmin') redirect('/dashboard?error=access_denied')

  return (
    <TouringCheckAdminClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={user.modules || []}
    />
  )
}
