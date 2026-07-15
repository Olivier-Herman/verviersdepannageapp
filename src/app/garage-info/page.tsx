// src/app/garage-info/page.tsx
// Module « Garage Info » : fermetures/infos garage, gérables par tous SAUF les
// chauffeurs (et garages externes). Olivier 2026-07-15.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import GarageInfoClient     from './GarageInfoClient'

export const dynamic = 'force-dynamic'

export default async function GarageInfoPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  if (user.role === 'driver' || user.role === 'garage') redirect('/dashboard?error=access_denied')

  return (
    <GarageInfoClient
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={user.modules || []}
    />
  )
}
