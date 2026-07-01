// src/app/fourriere/requisitoires/page.tsx
//
// File d'attente des réquisitoires capturés automatiquement dans fourriere@ :
// Claude lit la PJ PDF → propose la/les fiche(s) candidate(s) → un humain
// rattache. Aucune annexion automatique (Option A). Olivier 2026-07-01.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import RequisitoiresClient  from './RequisitoiresClient'

export const dynamic = 'force-dynamic'

export default async function RequisitoiresPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/requisitoires')

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=fourriere_required')

  return (
    <RequisitoiresClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={modules}
    />
  )
}
