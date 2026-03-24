// src/app/documents/page.tsx
export const dynamic = 'force-dynamic'

import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import DocumentsClient      from './DocumentsClient'

export const metadata = { title: 'Mes Documents — Verviers Dépannage' }

export default async function DocumentsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  return <DocumentsClient user={session.user} />
}
