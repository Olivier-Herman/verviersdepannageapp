import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { isPersonnelStaff }  from '@/lib/rh-access'
import { redirect }          from 'next/navigation'
import GardeConfigClient     from './GardeConfigClient'

export const dynamic = 'force-dynamic'

export default async function GardePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  if (!isPersonnelStaff(u)) redirect('/dashboard?error=access_denied')
  return <GardeConfigClient userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userModules={u.modules || []} />
}
