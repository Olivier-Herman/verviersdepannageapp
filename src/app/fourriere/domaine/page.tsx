// src/app/fourriere/domaine/page.tsx
//
// Module Domaine (SPF Finances) — hub Fourrière : gardiennage État + Vente
// d'épaves. Superadmin uniquement (phase actuelle). Olivier 2026-07-29.

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import DomaineClient        from './DomaineClient'

export default async function FourriereDomainePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/domaine')
  const user = session.user as any
  if (user.role !== 'superadmin') redirect('/dashboard?error=access_denied')

  return (
    <DomaineClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={user.modules || []}
    />
  )
}
