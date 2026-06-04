// src/app/fourriere/migration/archive/page.tsx
// Liste read-only des fiches TowSoft non scannees (= sorties avant migration).
// Olivier 2026-06-04.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import ArchiveClient        from './ArchiveClient'

export const dynamic = 'force-dynamic'

export default async function ArchivePage() {
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
    <ArchiveClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
    />
  )
}
