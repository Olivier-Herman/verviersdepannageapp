// src/app/bureau-du-jour/page.tsx — Bureau du jour (Olivier 17/10/2026) : la réunion bureau en un écran, en direct,
// sur une page à elle (pas dans l'environnement Administration). Mobi seul (superadmin) : ni Momo ni Jona.
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AppShell             from '@/components/layout/AppShell'
import BureauClient         from './BureauClient'

export const dynamic = 'force-dynamic'

export default async function BureauDuJourPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const roles: string[] = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])]
  if (!roles.includes('superadmin')) redirect('/dashboard?error=access_denied')
  return (
    <AppShell title="Bureau du jour" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={u.modules || []}>
      <BureauClient />
    </AppShell>
  )
}
