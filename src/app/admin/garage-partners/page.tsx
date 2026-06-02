import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminGaragePartnersClient from './AdminGaragePartnersClient'

export const dynamic = 'force-dynamic'

export default async function AdminGaragePartnersPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const { data } = await sb
    .from('garage_partners')
    .select('*')
    .order('active', { ascending: false })
    .order('name',   { ascending: true })

  return <AdminGaragePartnersClient initialPartners={(data || []) as any} />
}
