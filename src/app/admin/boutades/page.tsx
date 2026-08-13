// src/app/admin/boutades/page.tsx
// Historique des boutades chauffeur — superadmin (Mobi) uniquement.

import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import BoutadesClient       from './BoutadesClient'

export const dynamic = 'force-dynamic'

export default async function BoutadesPage() {
  const session = await getServerSession(authOptions)
  const role  = (session?.user as any)?.role || ''
  const roles = Array.isArray((session?.user as any)?.roles) ? (session!.user as any).roles : []
  if (role !== 'superadmin' && !roles.includes('superadmin')) redirect('/')
  return <BoutadesClient />
}
