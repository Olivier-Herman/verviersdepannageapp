// src/app/assistant/page.tsx
// Assistant personnel IA (Claude) avec tool use sur les actions de l app.
// Superadmin uniquement.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AssistantClient      from './AssistantClient'

export const dynamic = 'force-dynamic'

export default async function AssistantPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  if (!roles.includes('superadmin')) redirect('/dashboard?error=superadmin_required')

  return (
    <AssistantClient
      userRole={user.role || ''}
      userName={user.name || ''}
      userEmail={user.email}
      userId={user.id}
      userModules={user.modules || []}
    />
  )
}
