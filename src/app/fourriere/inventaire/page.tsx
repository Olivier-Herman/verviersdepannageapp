// src/app/fourriere/inventaire/page.tsx
// Mode inventaire mensuel de la fourriere.
// Acces : permission module "fourriere" (ou admin/superadmin).

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import InventaireClient from './InventaireClient'

export const dynamic = 'force-dynamic'

export default async function InventairePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/inventaire')

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=fourriere_required')

  return (
    <InventaireClient
      userRole={user.role || ''}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={user.modules || []}
    />
  )
}
