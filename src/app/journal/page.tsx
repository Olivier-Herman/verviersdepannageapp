// src/app/journal/page.tsx
// Module « Journal » — historique des gestes du terrain sur 24h / 30 jours / 6 mois.
// (Le slide tableau-bord reste sur 24h ; ici on remonte plus loin.) Staff only.

import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import JournalClient        from './JournalClient'

export const dynamic = 'force-dynamic'

export default async function JournalPage() {
  const session = await getServerSession(authOptions)
  const role  = (session?.user as any)?.role || ''
  const roles = Array.isArray((session?.user as any)?.roles) ? (session!.user as any).roles : []
  if (role !== 'superadmin' && !roles.includes('superadmin')) redirect('/')
  return <JournalClient />
}
