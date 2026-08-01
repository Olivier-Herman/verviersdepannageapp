import { getServerSession }  from 'next-auth'
import { isPersonnelStaff }  from '@/lib/rh-access'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import RentabiliteClient     from './RentabiliteClient'

export const dynamic = 'force-dynamic'

export default async function RentabilitePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  if (!isPersonnelStaff(u)) redirect('/dashboard?error=access_denied')
  return <RentabiliteClient
    userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userModules={u.modules || []} />
}
