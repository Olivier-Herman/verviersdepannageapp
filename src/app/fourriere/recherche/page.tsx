// src/app/fourriere/recherche/page.tsx
//
// Recherche avancée fourrière (plaque / PV / VIN / véhicule / adresse / policier).
// C'était la home /fourriere ; avec le menu Espaces + l'écran Parc (16/09/2026),
// elle vit ici — inchangée.
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import FourriereSearchClient from '../FourriereSearchClient'

export const dynamic = 'force-dynamic'

export default async function FourriereRecherchePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!(['admin', 'superadmin'].includes(role) || modules.includes('fourriere'))) redirect('/dashboard?error=access_denied')
  return <FourriereSearchClient userRole={role} userName={user.name || ''} userEmail={user.email} userModules={modules} />
}
