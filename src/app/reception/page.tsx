import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import ReceptionConsoleClient from './ReceptionConsoleClient'

export const dynamic = 'force-dynamic'

export default async function ReceptionPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  // Superadmin uniquement pendant les tests (élargir ensuite aux compétences).
  const isSuper = u.role === 'superadmin' || (u.roles || []).includes('superadmin')
  if (!isSuper) redirect('/dashboard?error=access_denied')
  return <ReceptionConsoleClient meName={u.name || ''} />
}
