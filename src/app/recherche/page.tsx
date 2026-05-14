// src/app/recherche/page.tsx
//
// Page recherche dediee. La palette ⌘K reste pour la recherche eclair en
// surimpression ; cette page offre une experience plein ecran avec des
// resultats plus riches et plus nombreux par categorie.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import RechercheClient       from './RechercheClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function RecherchePage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []

  return (
    <RechercheClient
      initialQuery={searchParams.q || ''}
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userId={user.id || ''}
      userModules={modules}
    />
  )
}
