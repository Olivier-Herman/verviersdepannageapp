import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminVisitesClient    from './AdminVisitesClient'

export const dynamic = 'force-dynamic'

export default async function AdminVisitesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string = (session.user as any).role || ''
  const roles: string[] = (session.user as any).roles || []
  if (!['admin', 'superadmin'].includes(role) && !roles.some(r => ['admin', 'superadmin'].includes(r)))
    redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const [motifs, bureaux] = await Promise.all([
    sb.from('visitor_motifs').select('*').order('sort_order', { ascending: true }).order('label', { ascending: true }),
    sb.from('expertise_bureaus').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true }),
  ])

  return <AdminVisitesClient initialMotifs={motifs.data || []} initialBureaux={bureaux.data || []} />
}
