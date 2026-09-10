// Module « Dossier de destruction » (Olivier 10/09/2026). Accès = module fourrière (comme la Sortie AVP).
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AppShell             from '@/components/layout/AppShell'
import DossiersClient from './DossiersClient'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/destruction/dossiers')
  const u = session.user as any
  const roles: string[] = [u.role, ...(u.roles || [])].filter(Boolean)
  const hasAccess = roles.some(r => ['admin', 'superadmin'].includes(r)) || (u.modules || []).includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=fourriere_required')
  return (
    <AppShell title="Dossiers de destruction" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userModules={u.modules || []}>
      <DossiersClient />
    </AppShell>
  )
}
