import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import FicheEmployeClient    from './FicheEmployeClient'

export const dynamic = 'force-dynamic'

export default async function FicheEmployePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const isSuper = u.role === 'superadmin' || (u.roles || []).includes('superadmin')
  if (!isSuper) redirect('/dashboard?error=access_denied')
  return <FicheEmployeClient id={params.id}
    userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userModules={u.modules || []} />
}
