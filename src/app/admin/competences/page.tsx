import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import CompetencesMatrixClient from './CompetencesMatrixClient'

export const dynamic = 'force-dynamic'

export default async function AdminCompetencesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const isSuper = u.role === 'superadmin' || (u.roles || []).includes('superadmin')
  if (!isSuper) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const [{ data: users }, { data: motifs }, { data: links }] = await Promise.all([
    sb.from('users').select('id, name, role').neq('role', 'garage').order('name'),
    sb.from('reception_motifs').select('id, label, kind, service').eq('active', true).order('sort_order').order('label'),
    sb.from('user_competences').select('user_id, motif_id'),
  ])

  return <CompetencesMatrixClient users={users || []} motifs={motifs || []} links={links || []} />
}
