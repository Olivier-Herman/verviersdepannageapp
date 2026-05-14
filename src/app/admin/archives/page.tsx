import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import DispatchSubNav        from '@/components/admin/DispatchSubNav'
import ArchivesClient        from './ArchivesClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function ArchivesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) redirect('/dashboard?error=access_denied')

  return (
    <>
      <DispatchSubNav />
      <ArchivesClient />
    </>
  )
}
