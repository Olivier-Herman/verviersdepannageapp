// /amendes : module saisie PV / amendes. Reserve admin/superadmin/facturation.
// Olivier 2026-06-01.

import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { redirect }         from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AmendesClient        from './AmendesClient'

export const metadata = { title: 'Amendes — VD Soft' }
export const dynamic = 'force-dynamic'

export default async function AmendesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')

  // Liste des chauffeurs pour l'attribution manuelle (si le matching auto échoue).
  const sb = createAdminClient()
  const { data: drivers } = await sb
    .from('users')
    .select('id, name')
    .or('role.in.(driver,dispatcher,admin,superadmin),roles.ov.{driver,dispatcher,admin,superadmin}')
    .eq('active', true)
    .order('name')

  return <AmendesClient user={user} drivers={drivers || []} />
}
