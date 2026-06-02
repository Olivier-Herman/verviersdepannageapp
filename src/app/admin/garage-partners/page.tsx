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
    .select(`*, garage_tariffs ( dsp_price, rem_price, dpr_price, currency )`)
    .order('active', { ascending: false })
    .order('name',   { ascending: true })

  const partners = (data || []).map(p => ({
    ...p,
    tariffs: Array.isArray((p as any).garage_tariffs) && (p as any).garage_tariffs.length > 0
      ? (p as any).garage_tariffs[0]
      : { dsp_price: null, rem_price: null, dpr_price: null, currency: 'EUR' },
    garage_tariffs: undefined,
  }))

  return <AdminGaragePartnersClient initialPartners={partners} />
}
