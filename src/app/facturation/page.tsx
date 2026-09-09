// src/app/facturation/page.tsx
//
// Page Facturation — liste des missions terminees par chauffeur en attente
// de validation (statut to_invoice). L'employe facturation valide chaque fiche
// avec un numero de facture Odoo ou marque "auto-facturation" (compagnie qui
// valide elle-meme).

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { loadFacturationData } from '@/lib/facturation/load-data'
import { isPreviewOn }  from '@/lib/feature-flags'
import FacturationClient     from './FacturationClient'
import { billingGroups } from '@/lib/missions/source-catalog'

export const dynamic = 'force-dynamic'

export default async function FacturationPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const modules: string[] = user.modules || []
  const role: string      = user.role || ''
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')
  // Olivier 08/09/2026 : pour ceux qui ont la Vue dossier, le menu Facturation
  // ouvre la facturation PAR DOSSIER ; ?classic=1 garde l'ancienne page.
  if (!searchParams?.classic && (role === 'superadmin' || await isPreviewOn('dossier_view', role, user.id))) redirect('/facturation/dossiers')

  const supabase = createAdminClient()
  // Olivier 2026-06-24 : les missions Touring n'apparaissent PAS dans la liste
  // générale — uniquement sur la page dédiée /facturation/touring.
  const { missions, siblings, payments, drivers, advances, billingRemarks, sourceLabels } =
    await loadFacturationData(supabase, { excludeSource: 'touring', hideAutoInvoiced: role !== 'superadmin' })

  return (
    <FacturationClient
      missions={missions}
      siblings={siblings}
      payments={payments}
      drivers={drivers}
      advances={advances}
      billingRemarks={billingRemarks}
      sourceLabels={sourceLabels}
      billingGroups={await billingGroups()}
      userRole={role}
      dossierView={role === 'superadmin' || await isPreviewOn('dossier_view', role, user.id)}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
    />
  )
}
