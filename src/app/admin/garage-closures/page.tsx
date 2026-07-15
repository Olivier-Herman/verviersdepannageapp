// src/app/admin/garage-closures/page.tsx
// Module « Fermetures de garage » — admin/superadmin. Olivier 2026-07-15.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import GarageClosuresClient from './GarageClosuresClient'

export const dynamic = 'force-dynamic'

export default async function GarageClosuresPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const roles: string[] = [user.role, ...(Array.isArray(user.roles) ? user.roles : [])].filter(Boolean)
  if (!roles.some(r => ['admin', 'superadmin'].includes(r))) redirect('/dashboard?error=access_denied')

  return (
    <GarageClosuresClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={user.modules || []}
    />
  )
}
