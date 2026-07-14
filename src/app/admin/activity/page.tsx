// src/app/admin/activity/page.tsx
// Journal d'activité global (« mouchard ») — superadmin uniquement. Olivier 2026-07-14.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import ActivityClient       from './ActivityClient'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  if (user.role !== 'superadmin') redirect('/dashboard?error=access_denied')

  return (
    <ActivityClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={user.modules || []}
    />
  )
}
