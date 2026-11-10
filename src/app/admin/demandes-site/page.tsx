import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { sessionAccess }     from '@/lib/access'
import DemandesSiteClient    from './DemandesSiteClient'

export const dynamic = 'force-dynamic'

export default async function DemandesSitePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!sessionAccess(session, { roles: ['admin', 'superadmin'] }).ok) redirect('/dashboard?error=access_denied')
  return <DemandesSiteClient />
}
