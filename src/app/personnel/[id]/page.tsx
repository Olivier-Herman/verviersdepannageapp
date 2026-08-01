import { getServerSession }  from 'next-auth'
import { isPersonnelStaff }  from '@/lib/rh-access'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import FicheEmployeClient    from './FicheEmployeClient'

export const dynamic = 'force-dynamic'

export default async function FicheEmployePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  if (!isPersonnelStaff(u)) redirect('/dashboard?error=access_denied')
  return <FicheEmployeClient id={params.id}
    userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userModules={u.modules || []} />
}
