// src/app/dispatch/dossier/[id]/page.tsx
//
// Vue DOSSIER unifiée (preview). NOUVELLE route — ne modifie pas la fiche
// existante /dispatch/[id]. Accès : superadmin toujours (preview), les autres
// uniquement si le flag 'dossier_view' est en mode 'all'. Sinon → fiche classique.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { isPreviewOn }      from '@/lib/feature-flags'
import AppShell             from '@/components/layout/AppShell'
import DossierClient        from './DossierClient'

export const dynamic = 'force-dynamic'

export default async function DossierPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u    = session.user as any
  const role = u.role || ''

  // Superadmin : toujours accès (c'est lui qui teste). Les autres : seulement si
  // le flag est passé à 'all'. Sinon on renvoie sur la fiche classique (zéro impact).
  const allowed = role === 'superadmin' || (await isPreviewOn('dossier_view', role))
  if (!allowed) redirect(`/dispatch/${params.id}`)

  return (
    <AppShell
      title="Dossier"
      userName={u.name || ''}
      userEmail={u.email || ''}
      userId={u.id}
      userRole={role}
      userModules={u.modules || []}
    >
      <DossierClient id={params.id} isSuperadmin={role === 'superadmin'} />
    </AppShell>
  )
}
