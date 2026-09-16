// src/app/fourriere/page.tsx

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
// Olivier 2026-06-03 : la home /fourriere est maintenant l ecran de recherche.
// L ancienne vue inventaire (FourriereClient) est sur /fourriere/parc/[id].
import FourriereSearchClient from './FourriereSearchClient'
import ParcClient            from './ParcClient'
import { isPreviewOn }       from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

export default async function FourrierePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  // Refonte Fourrière (16/09/2026) : l'écran « Parc » pour les pilotes (flag
  // fourriere_v2) ; les autres gardent la recherche. La recherche reste sur
  // /fourriere/recherche pour tout le monde.
  if (await isPreviewOn('fourriere_v2', role, user.id)) {
    return <ParcClient userRole={role} userName={user.name || ''} userEmail={user.email} userModules={modules} />
  }
  return (
    <FourriereSearchClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
    />
  )
}
