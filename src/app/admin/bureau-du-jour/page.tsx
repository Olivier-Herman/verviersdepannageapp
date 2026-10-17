// src/app/admin/bureau-du-jour/page.tsx — Bureau du jour (Olivier 17/10/2026) : la réunion bureau en un écran,
// en direct, pendant qu'on travaille. Mobi seul (superadmin) : ni Momo ni Jona.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import BureauClient         from './BureauClient'

export const dynamic = 'force-dynamic'

export default async function BureauDuJourPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const roles: string[] = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])]
  if (!roles.includes('superadmin')) redirect('/admin?error=access_denied')
  return <BureauClient />
}
