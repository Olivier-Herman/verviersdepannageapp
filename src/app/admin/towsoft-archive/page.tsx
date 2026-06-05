// src/app/admin/towsoft-archive/page.tsx
// Admin TowSoft Archive : init + rattraper tout. Olivier 2026-06-05.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import TowsoftArchiveClient from './TowsoftArchiveClient'

export const dynamic = 'force-dynamic'

export default async function TowsoftArchivePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role || '')) redirect('/dashboard?error=access_denied')

  return (
    <TowsoftArchiveClient
      userRole={user.role || ''}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={user.modules || []}
    />
  )
}
