// src/app/admin/decharges/page.tsx
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import DechargesAdminClient from './DechargesAdminClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Décharges — VD Soft' }

export default async function DechargesAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard?error=access_denied')

  return <DechargesAdminClient userName={session.user.name || ''} userRole={role} userEmail={session.user.email || undefined} userId={(session.user as any).id} userModules={(session.user as any).modules || []} />
}
