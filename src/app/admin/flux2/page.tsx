// src/app/admin/flux2/page.tsx
//
// Grille d'activation du flux 2 (clôture unifiée « Action ») : chauffeurs ×
// assistances. Superadmin uniquement. Olivier 2026-08-11.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import Flux2GridClient      from './Flux2GridClient'

export const dynamic = 'force-dynamic'

export default async function Flux2Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const isSuper = (user.roles || [user.role]).includes('superadmin')
  if (!isSuper) redirect('/dashboard?error=access_denied')
  return <Flux2GridClient />
}
