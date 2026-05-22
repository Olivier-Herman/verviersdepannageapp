// src/app/fourriere/destruction/page.tsx
//
// Page admin "Destruction fin de mois" : liste les AVP > 60 jours en parc,
// permet de les cocher (scan QR ou manuel), valider + envoi rapport email
// a la Ville de Verviers.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import DestructionClient    from './DestructionClient'

export const dynamic = 'force-dynamic'

export default async function DestructionPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/destruction')

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) redirect('/dashboard?error=fourriere_required')

  return (
    <DestructionClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={modules}
    />
  )
}
