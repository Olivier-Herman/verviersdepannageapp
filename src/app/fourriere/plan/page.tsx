// src/app/parc/plan/page.tsx
//
// Plan visuel du parc fourriere : grille drag&drop des vehicules
// par zone/ligne/slot. Lecture pour tous, ecriture limite selon role
// (drivers : A et Transit uniquement, cf. memoire equipe).

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import ParcPlanClient        from './ParcPlanClient'

export const dynamic = 'force-dynamic'

export default async function ParcPlanPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const normalized = roles.map(r => String(r ?? '').toLowerCase())
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isSuperadmin = normalized.includes('superadmin')
  const isAdmin      = isSuperadmin || normalized.includes('admin')
  const isDispatcher = isAdmin || normalized.includes('dispatcher')
  const isDriver     = isSuperadmin || normalized.includes('chauffeur') || normalized.includes('driver')
  const canBlock     = isAdmin || modules.includes('fourriere')

  return (
    <ParcPlanClient
      isDispatcher={isDispatcher}
      isDriver={isDriver}
      canEditLayout={isAdmin}
      canBlock={canBlock}
      userRole={user.role || ''}
      userName={user.name || ''}
      userEmail={user.email || undefined}
      userModules={user.modules || []}
    />
  )
}
