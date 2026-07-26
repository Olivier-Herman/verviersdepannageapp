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
import FacturationClient     from './FacturationClient'

export const dynamic = 'force-dynamic'

export default async function FacturationPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const modules: string[] = user.modules || []
  const role: string      = user.role || ''
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const supabase = createAdminClient()
  // Olivier 2026-06-24 : les missions Touring n'apparaissent PAS dans la liste
  // générale — uniquement sur la page dédiée /facturation/touring.
  const { missions, siblings, payments, drivers, advances, billingRemarks, sourceLabels } =
    await loadFacturationData(supabase, { excludeSource: 'touring' })

  return (
    <FacturationClient
      missions={missions}
      siblings={siblings}
      payments={payments}
      drivers={drivers}
      advances={advances}
      billingRemarks={billingRemarks}
      sourceLabels={sourceLabels}
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
    />
  )
}
