// Admin › AXA go&assist (superadmin) — état de la connexion, réamorçage du
// jeton, clôtures à repousser. Audit 10/09/2026.
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AxaClient             from './AxaClient'

export const dynamic = 'force-dynamic'

export default async function AxaAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const roles = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  if (!roles.includes('superadmin')) redirect('/dashboard?error=access_denied')
  return <AxaClient />
}
