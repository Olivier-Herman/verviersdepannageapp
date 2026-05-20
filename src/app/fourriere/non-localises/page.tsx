// src/app/fourriere/non-localises/page.tsx
//
// Page de gestion des vehicules non-localises : ceux passes en
// status='unlocated' par /api/inventaire/sessions/[id]/finish-zone
// quand on a scanne une zone et qu ils n etaient pas a leur place.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import NonLocalisesClient   from './NonLocalisesClient'

export const dynamic = 'force-dynamic'

export default async function NonLocalisesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/non-localises')

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=fourriere_required')

  return (
    <NonLocalisesClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={modules}
    />
  )
}
