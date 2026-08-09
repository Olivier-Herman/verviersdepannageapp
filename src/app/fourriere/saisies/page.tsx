// src/app/fourriere/saisies/page.tsx
//
// Cockpit Facturation SAISIE — hub Fourrière. Accès : admin / superadmin /
// module fourriere. Olivier 2026-08-09.

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import SaisiesClient        from './SaisiesClient'

export default async function FourriereSaisiesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/saisies')
  const user = session.user as any
  const ok = ['admin', 'superadmin'].includes(user.role || '') || (user.modules || []).includes('fourriere')
  if (!ok) redirect('/dashboard?error=access_denied')

  return (
    <SaisiesClient
      userRole={user.role || ''}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={user.modules || []}
    />
  )
}
