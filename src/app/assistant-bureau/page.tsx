// src/app/assistant-bureau/page.tsx
// Assistant bureau (Olivier 14/10/2026) : comprendre et corriger un dossier, sur
// confirmation, jamais de facturation. Superadmin ou réglage « assistant_bureau_users ».
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { canUseBureau }     from '@/lib/assistant/bureau'
import AssistantClient      from '../assistant/AssistantClient'

export const dynamic = 'force-dynamic'

export default async function AssistantBureauPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login?callbackUrl=/assistant-bureau')
  const user = session.user as any
  const roles: string[] = [user.role, ...(Array.isArray(user.roles) ? user.roles : [])].filter(Boolean)
  if (!(await canUseBureau({ email: user.email, role: user.role, roles }))) redirect('/dashboard')
  return <AssistantClient mode="bureau" userRole={user.role || ''} userName={user.name || ''} userEmail={user.email} userId={user.id} userModules={user.modules || []} />
}
