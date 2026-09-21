// src/app/facturation/dossiers/[id]/page.tsx
//
// FACTURATION DU DOSSIER, version allégée (Olivier 21/09/2026, maquette
// validée : « ok ça me semble un peu mieux », puis « vas-y, on va essayer
// ainsi déjà »). Une ligne par prestation avec le pourquoi du montant, une
// case à cocher par prestation, un seul bouton qui annonce ce qu'il va faire.
// La Vue dossier (/dispatch/dossier/[id]) reste l'écran opérationnel complet.
// Accès : module facturation (comme la liste « À facturer »).

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { isPreviewOn }       from '@/lib/feature-flags'
import { buildDossier }      from '@/lib/dossier/build'
import AppShell              from '@/components/layout/AppShell'
import FactureDossierClient  from './FactureDossierClient'

export const dynamic = 'force-dynamic'

export default async function FactureDossierPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const role: string = u.role || ''
  const modules: string[] = u.modules || []
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')
  if (role !== 'superadmin' && !(await isPreviewOn('dossier_view', role, u.id))) redirect('/facturation')

  // Montants calculés par le moteur (comme la liste), raccourcis du mode léger conservés.
  const dossier = await buildDossier(params.id, { light: true, price: true })
  if (!dossier) redirect('/facturation/dossiers')

  return (
    <AppShell title={`Facturation ${dossier.ref}`} userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={role} userModules={modules}>
      <FactureDossierClient initial={dossier} />
    </AppShell>
  )
}
