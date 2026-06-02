import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import AdminGarageUsersClient from './AdminGarageUsersClient'

export const dynamic = 'force-dynamic'

export default async function AdminGarageUsersPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role: string = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()

  // Liste partners (pour le multi-select)
  const { data: partnersData } = await sb
    .from('garage_partners')
    .select('id, name, active')
    .eq('active', true)
    .order('name', { ascending: true })

  // Liste users garage
  const { data: usersData } = await sb
    .from('users')
    .select(`
      id, email, name, active, last_login, created_at,
      garage_user_partners ( garage_partner_id, is_default, last_selected_at,
        garage_partners ( id, name, active ) )
    `)
    .eq('role', 'garage')
    .order('created_at', { ascending: false })

  const users = (usersData || []).map(u => ({
    id:          u.id,
    email:       u.email,
    name:        u.name,
    active:      u.active,
    last_login:  u.last_login,
    created_at:  u.created_at,
    partners: (Array.isArray((u as any).garage_user_partners) ? (u as any).garage_user_partners : [])
      .filter((gup: any) => gup.garage_partners && gup.garage_partners.active)
      .map((gup: any) => ({
        id:               gup.garage_partners.id,
        name:             gup.garage_partners.name,
        is_default:       gup.is_default,
        last_selected_at: gup.last_selected_at,
      })),
  }))

  return <AdminGarageUsersClient initialUsers={users} allPartners={partnersData || []} />
}
