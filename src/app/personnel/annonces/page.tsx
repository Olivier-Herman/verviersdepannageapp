import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AnnoncesClient        from './AnnoncesClient'

export const dynamic = 'force-dynamic'

export default async function AnnoncesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  if (u.role !== 'superadmin') redirect('/personnel?error=access_denied')
  return <AnnoncesClient userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userModules={u.modules || []} />
}
