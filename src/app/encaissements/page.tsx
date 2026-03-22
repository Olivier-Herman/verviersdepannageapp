import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import EncaissementsClient from './EncaissementsClient'

export default async function EncaissementsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  return <EncaissementsClient userRole={session.user.role} userId={(session.user as any).id} />
}
