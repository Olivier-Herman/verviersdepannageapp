// Console VAB (superadmin) — pilotage pas-à-pas d'une mission VAB Comet pour la
// clôture (avec Franck en live). ⚠️ Actions IRRÉVERSIBLES côté VAB.
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import VabConsoleClient      from './VabConsoleClient'

export const dynamic = 'force-dynamic'

export default async function VabConsolePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const roles = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  if (!roles.includes('superadmin')) redirect('/dashboard?error=access_denied')
  return <VabConsoleClient />
}
