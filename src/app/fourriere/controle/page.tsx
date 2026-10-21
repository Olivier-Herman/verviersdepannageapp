// src/app/fourriere/controle/page.tsx — Contrôle du parc : écran de contrôle en direct + analyse (Olivier 21/10/2026).
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import AppShell             from '@/components/layout/AppShell'
import ControleClient       from './ControleClient'

export const dynamic = 'force-dynamic'

export default async function ControlePage({ searchParams }: { searchParams: { id?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/controle')
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok) redirect('/dashboard?error=fourriere_required')
  const u = session.user as any
  return (
    <AppShell title="Contrôle du parc" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={u.modules || []}>
      <ControleClient initialId={searchParams?.id || null} />
    </AppShell>
  )
}
