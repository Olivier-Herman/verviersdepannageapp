export const dynamic = 'force-dynamic'
export const revalidate = 0

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import DomaineClient from './DomaineClient'

export default async function AdminDomainePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const modules: string[] = user.modules || []
  const role: string = user.role || ''
  const ok = ['admin', 'superadmin'].includes(role) || modules.includes('fourriere')
  if (!ok) redirect('/dashboard?error=access_denied')

  return (
    <DomaineClient
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={modules}
    />
  )
}
