import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminReceptionMotifsClient from './AdminReceptionMotifsClient'

export const dynamic = 'force-dynamic'

export default async function AdminReceptionMotifsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const { data: motifs } = await sb.from('reception_motifs').select('*')
    .order('sort_order', { ascending: true }).order('label', { ascending: true })

  return <AdminReceptionMotifsClient initialMotifs={motifs || []} />
}
