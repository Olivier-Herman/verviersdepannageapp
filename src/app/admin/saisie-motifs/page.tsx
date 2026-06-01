import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminSaisieMotifsClient from './AdminSaisieMotifsClient'

export const dynamic = 'force-dynamic'

export default async function AdminSaisieMotifsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const { data: motifs } = await sb
    .from('police_saisie_motifs')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  return <AdminSaisieMotifsClient initialMotifs={motifs || []} />
}
