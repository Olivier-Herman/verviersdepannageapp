// src/app/fourriere/domaine/dates-in/page.tsx
//
// Domaine — Sujet 1 « Dates IN » : remises officielles au Domaine (SPF Finances).
// Superadmin uniquement (phase actuelle). Olivier 2026-07-29.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import DatesInClient        from './DatesInClient'

export const dynamic = 'force-dynamic'

export default async function FourriereDomaineDatesInPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/fourriere/domaine/dates-in')
  const user = session.user as any
  if (user.role !== 'superadmin') redirect('/dashboard?error=access_denied')

  return (
    <DatesInClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={user.modules || []}
    />
  )
}
