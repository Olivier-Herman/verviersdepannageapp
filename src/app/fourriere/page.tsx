// src/app/fourriere/page.tsx

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
// Olivier 2026-06-03 : la home /fourriere est maintenant l ecran de recherche.
// L ancienne vue inventaire (FourriereClient) est sur /fourriere/parc/[id].
import FourriereSearchClient from './FourriereSearchClient'

export const dynamic = 'force-dynamic'

export default async function FourrierePage() {
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
    <FourriereSearchClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
    />
  )
}
