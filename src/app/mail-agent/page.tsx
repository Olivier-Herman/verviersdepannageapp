// Agent Mail — file de traitement des mails administratifs.
// Accès : admin / superadmin / module facturation.

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { sessionAccess }    from '@/lib/access'
import MailAgentClient      from './MailAgentClient'

export const dynamic = 'force-dynamic'

export default async function MailAgentPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const access = sessionAccess(session, { roles: ['superadmin'] })
  if (!access.ok) redirect('/dashboard?error=superadmin_required')

  const user = session.user as any
  return (
    <MailAgentClient
      isSuperadmin={access.roles.includes('superadmin')}
      canApply={access.roles.some(r => ['admin', 'superadmin'].includes(r))}
      odooBase={process.env.ODOO_URL || ''}
      userRole={user.role || ''}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userModules={user.modules || []}
    />
  )
}
