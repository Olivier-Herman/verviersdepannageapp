// src/app/fourriere/gardiennage/nouveau/page.tsx
//
// Formulaire « Véhicule apporté par un transporteur » (Olivier 28/09/2026) :
// crée une fiche gardiennage depuis le téléphone. Ouvert par une tuile du
// dashboard. Accès : module Fourrière ou admin.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import AppShell             from '@/components/layout/AppShell'
import GardiennageArrivalClient from './GardiennageArrivalClient'

export const dynamic = 'force-dynamic'

export default async function GardiennageArrivalPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok) redirect('/dashboard?error=access_denied')
  const u = session.user as any
  return (
    <AppShell title="Nouveau gardiennage" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={u.role || ''} userModules={u.modules || []}>
      <GardiennageArrivalClient />
    </AppShell>
  )
}
