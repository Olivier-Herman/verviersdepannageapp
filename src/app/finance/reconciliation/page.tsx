import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import { sessionAccess }    from '@/lib/access'
import ReconciliationClient from './ReconciliationClient'

export const dynamic = 'force-dynamic'

export default async function ReconciliationPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const access = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['facturation'] })
  if (!access.ok) redirect('/dashboard')

  return <ReconciliationClient userName={session.user?.name || ''} />
}
