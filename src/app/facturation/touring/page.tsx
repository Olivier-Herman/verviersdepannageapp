// src/app/facturation/touring/page.tsx
//
// Page Facturation dédiée Touring : uniquement les missions source='touring'.
// Les Touring n'apparaissent PAS dans la liste générale. Olivier 2026-06-24.

import { getServerSession }    from 'next-auth'
import { redirect }            from 'next/navigation'
import { authOptions }         from '@/lib/auth'
import { createAdminClient }   from '@/lib/supabase'
import { loadFacturationData } from '@/lib/facturation/load-data'
import FacturationClient       from '../FacturationClient'

export const dynamic = 'force-dynamic'

export default async function FacturationTouringPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const modules: string[] = user.modules || []
  const role: string      = user.role || ''
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  const supabase = createAdminClient()
  const { missions, siblings, payments, drivers, advances } =
    await loadFacturationData(supabase, { onlySource: 'touring' })

  return (
    <FacturationClient
      missions={missions}
      siblings={siblings}
      payments={payments}
      drivers={drivers}
      advances={advances}
      userRole={role}
      userName={user.name || ''}
      userEmail={user.email}
      userModules={modules}
      variant="touring"
    />
  )
}
