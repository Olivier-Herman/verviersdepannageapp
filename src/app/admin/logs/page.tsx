// src/app/admin/logs/page.tsx
// Page logs erreurs serveur (superadmin uniquement).
// Olivier 2026-06-03 (audit J-2 W4).

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import LogsClient           from './LogsClient'

export const dynamic = 'force-dynamic'

export default async function LogsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  if (user.role !== 'superadmin') redirect('/dashboard?error=access_denied')

  return (
    <LogsClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={user.modules || []}
    />
  )
}
