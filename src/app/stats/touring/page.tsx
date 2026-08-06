// src/app/stats/touring/page.tsx — page « Déroulement Touring » (module Statistiques)
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import TouringDeroulementClient from './TouringDeroulementClient'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!(['admin', 'superadmin'].includes(role) || modules.includes('stats'))) {
    redirect('/dashboard?error=access_denied')
  }
  return (
    <TouringDeroulementClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userId={user.id}
      userModules={modules}
    />
  )
}
