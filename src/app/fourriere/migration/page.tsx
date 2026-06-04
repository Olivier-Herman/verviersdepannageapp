// src/app/fourriere/migration/page.tsx
// Module Reconstruction Fourriere TowSoft -> VD Soft.
// Olivier 2026-06-04.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import MigrationClient       from './MigrationClient'

export const dynamic = 'force-dynamic'

export default async function MigrationPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  return (
    <MigrationClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
    />
  )
}
