import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import FacturationAutoClient from './FacturationAutoClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function FacturationAutoPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  // Superadmin uniquement.
  if (user.role !== 'superadmin') redirect('/dashboard?error=access_denied')

  return (
    <FacturationAutoClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={user.modules || []}
    />
  )
}
