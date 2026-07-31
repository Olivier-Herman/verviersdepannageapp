import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AchatsClient          from './AchatsClient'

export const dynamic = 'force-dynamic'

export default async function AchatsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  // Superadmin uniquement pendant la phase de test (rôle Acheteur à venir).
  const isSuper = u.role === 'superadmin' || (u.roles || []).includes('superadmin')
  if (!isSuper) redirect('/dashboard?error=access_denied')

  return <AchatsClient
    userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''}
    userModules={u.modules || []} />
}
