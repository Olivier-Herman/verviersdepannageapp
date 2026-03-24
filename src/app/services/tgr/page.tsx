// src/app/services/tgr/page.tsx
export const dynamic = 'force-dynamic'

import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import TGRClient            from './TGRClient'

export const metadata = { title: 'TGR Touring — Verviers Dépannage' }

export default async function TGRPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  return <TGRClient user={session.user} />
}
