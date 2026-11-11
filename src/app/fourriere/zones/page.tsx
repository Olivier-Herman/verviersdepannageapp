// src/app/fourriere/zones/page.tsx
//
// Vue « Par zone » du parc (Q1/Q2, préversion ma_journee, Olivier 11/11/2026) :
// on range par ZONE, jamais par rangée. Une colonne par zone, zones d'attente
// en premier ; déplacement d'un ou plusieurs véhicules d'un geste. Le plan
// dessiné reste à /fourriere/plan. Accès : admin / superadmin / module fourrière.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import { isPreviewOn }      from '@/lib/feature-flags'
import AppShell             from '@/components/layout/AppShell'
import ZonesClient          from './ZonesClient'

export const dynamic = 'force-dynamic'

export default async function ZonesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/zones')
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok) redirect('/dashboard?error=fourriere_required')
  const u = session.user as any
  if (!(await isPreviewOn('ma_journee', u.role, u.id))) redirect('/fourriere/plan')
  return (
    <AppShell title="Parc par zone" userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userId={u.id} userModules={u.modules || []}>
      <ZonesClient />
    </AppShell>
  )
}
