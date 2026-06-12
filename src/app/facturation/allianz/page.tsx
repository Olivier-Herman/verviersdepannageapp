// src/app/facturation/allianz/page.tsx
//
// Page "Clôture Allianz" — liste les missions Mondial/AWP (Hexalite) à clôturer
// et permet l autoclôture. Accès : admin / superadmin / module facturation.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AllianzClotureClient from './AllianzClotureClient'

export const dynamic = 'force-dynamic'

export default async function AllianzCloturePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/facturation/allianz')

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  return (
    <AllianzClotureClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={modules}
    />
  )
}
