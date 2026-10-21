// src/app/fourriere/controle/scanner/page.tsx — Contrôle du parc : scan au téléphone, zone par zone (Olivier 21/10/2026).
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import AppShell             from '@/components/layout/AppShell'
import ScanClient           from './ScanClient'

export const dynamic = 'force-dynamic'

export default async function ControleScanPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/controle/scanner')
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok) redirect('/dashboard?error=fourriere_required')
  const u = session.user as any
  return (
    <AppShell title="Scanner le parc" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={u.modules || []}>
      <ScanClient userName={String(u.name || '').split(' ')[0]} />
    </AppShell>
  )
}
