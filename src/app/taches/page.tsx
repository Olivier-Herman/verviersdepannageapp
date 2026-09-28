// src/app/taches/page.tsx
//
// Module Tâches — premier jet (spec Olivier 28/09/2026) : la fourrière prend
// en charge les véhicules arrivés au parc sur appel police (accident), une
// question à la fois. Accès : module Fourrière ou admin ; flag `taches_accident`
// (pilote superadmins + Jona) le temps du premier jet.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import { isPreviewOn }      from '@/lib/feature-flags'
import TachesClient         from './TachesClient'

export const dynamic = 'force-dynamic'

export default async function TachesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const a = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['fourriere'] })
  if (!a.ok) redirect('/dashboard?error=access_denied')
  const role = (session.user as any)?.role || a.roles[0] || null
  if (!(await isPreviewOn('taches_accident', role, a.id))) redirect('/fourriere')
  return <TachesClient gmKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''} />
}
