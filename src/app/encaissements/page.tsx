import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import EncaissementsClient from './EncaissementsClient'

export default async function EncaissementsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const sessionUser = session.user as any
  return (
    <EncaissementsClient
      userRole={session.user.role}
      userId={sessionUser.id}
      userName={session.user.name || ''}
      userModules={sessionUser.modules || []}
    />
  )
}
