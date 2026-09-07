import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AdminExpertsClient    from './AdminExpertsClient'

export const dynamic = 'force-dynamic'

export default async function AdminExpertsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string = (session.user as any).role || ''
  const roles: string[] = (session.user as any).roles || []
  if (!['admin', 'superadmin'].includes(role) && !roles.some(r => ['admin', 'superadmin'].includes(r)))
    redirect('/dashboard?error=access_denied')
  return <AdminExpertsClient />
}
