// src/app/dispatch/page.tsx

import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import DispatchClient       from './DispatchClient'

export default async function DispatchPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].some(r =>
    (user.roles || [user.role]).includes(r)
  )
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  // Récupérer les chauffeurs actifs pour le dropdown d'assignation
  const supabase = createAdminClient()
  const { data: drivers } = await supabase
    .from('users')
    .select('id, name, avatar_url')
    .eq('active', true)
    .in('role', ['driver', 'admin', 'superadmin'])
    .order('name')

  return (
    <DispatchClient
      drivers={drivers || []}
      userName={user.name || ''}
      userRole={user.role || ''}
    />
  )
}
