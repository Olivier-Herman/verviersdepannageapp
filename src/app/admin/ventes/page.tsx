import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import AdminVentesClient     from './AdminVentesClient'
import { loadVentesAdminData } from '@/lib/ventes/admin-data'

export const dynamic = 'force-dynamic'

export default async function AdminVentesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin'], modules: ['ventes', 'facturation'] })
  if (!acc.ok) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const { sales, abandons } = await loadVentesAdminData(sb)

  return (
    <AdminVentesClient initialSales={sales} abandons={abandons} />
  )
}
