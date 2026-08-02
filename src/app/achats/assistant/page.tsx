import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AssistantClient       from './AssistantClient'

export const dynamic = 'force-dynamic'

export default async function AssistantPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const isSuper = u.role === 'superadmin' || (u.roles || []).includes('superadmin')
  if (!isSuper) redirect('/dashboard?error=access_denied')
  return <AssistantClient userRole={u.role || ''} userName={u.name || ''} userEmail={u.email || ''} userModules={u.modules || []} />
}
