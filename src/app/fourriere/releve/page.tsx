// src/app/fourriere/releve/page.tsx — Relevé de parc sans étiquette (Olivier 18/10/2026, inventaire de Verviers).
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import AppShell             from '@/components/layout/AppShell'
import ReleveClient         from './ReleveClient'

export const dynamic = 'force-dynamic'

export default async function RelevePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/releve')
  const u = session.user as any
  const modules: string[] = u.modules || []
  if (!['admin', 'superadmin'].includes(u.role || '') && !modules.includes('fourriere')) redirect('/dashboard?error=fourriere_required')
  return (
    <AppShell title="Relevé sans étiquette" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={modules}>
      <ReleveClient />
    </AppShell>
  )
}
