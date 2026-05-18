// src/app/admin/tarifs/page.tsx
// Gestion des tarifs par source d assistance. Superadmin uniquement.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import TarifsClient          from './TarifsClient'

export const dynamic = 'force-dynamic'

export default async function TarifsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  if (!roles.includes('superadmin')) redirect('/dashboard?error=superadmin_required')

  return (
    <TarifsClient
      userRole={user.role || ''}
      userName={user.name || ''}
      userEmail={user.email}
      userId={user.id}
      userModules={user.modules || []}
    />
  )
}
