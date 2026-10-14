// src/app/admin/max-echanges/page.tsx
//
// Conversations de Max avec le bureau (Olivier 14/10/2026) : toutes les personnes, en
// détail et en lecture seule. Superadmin uniquement ; chaque ouverture est journalisée.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import MaxEchangesClient    from './MaxEchangesClient'

export const dynamic = 'force-dynamic'

export default async function MaxEchangesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const roles: string[] = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])]
  if (!roles.includes('superadmin')) redirect('/admin?error=access_denied')
  return <MaxEchangesClient />
}
