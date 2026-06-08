// src/app/circuit/page.tsx
//
// Page Prestations Circuit Spa-Francorchamps
// Acces : dispatcher / admin / superadmin

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AppShell              from '@/components/layout/AppShell'
import CircuitClient         from './CircuitClient'

export const dynamic = 'force-dynamic'

export default async function CircuitPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  const user = session.user as any
  const role = user.role || ''
  const roles = Array.isArray(user.roles) ? user.roles : []
  const allowed = ['dispatcher', 'admin', 'superadmin']
  const hasAccess = allowed.includes(role) || roles.some((r: string) => allowed.includes(r))
  if (!hasAccess) redirect('/dashboard')

  return (
    <AppShell
      title="Prestations Circuit"
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userId={user.id || ''}
      userModules={user.modules || []}
    >
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        <CircuitClient />
      </div>
    </AppShell>
  )
}
