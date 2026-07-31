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
  const [{ data: usersRaw }, { data: motifs }, { data: links }] = await Promise.all([
    sb.from('users').select('id, name, role, roles, active').order('name'),
    sb.from('reception_motifs').select('id, label, kind, service').eq('active', true).order('sort_order').order('label'),
    sb.from('user_competences').select('user_id, motif_id'),
  ])
  const users = (usersRaw || []).filter(isReceptionStaff)

  return <CompetencesMatrixClient users={users} motifs={motifs || []} links={links || []} />
}

// Employés « réception » : au moins un rôle desk/téléphonie (exclut les purs
// chauffeurs et les garages). Gère role singulier + roles[].
function isReceptionStaff(u: any): boolean {
  if (u.active === false) return false
  const STAFF = ['dispatcher', 'admin', 'superadmin']
  const roles: string[] = (u.roles && u.roles.length ? u.roles : [u.role]).filter(Boolean)
  return roles.some(r => STAFF.includes(r))
}
