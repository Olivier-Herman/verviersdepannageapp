import { createAdminClient } from '@/lib/supabase'
import UsersClient from './UsersClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function UsersPage() {
  const supabase = createAdminClient()

  const { data: users } = await supabase
    .from('users')
    .select(`
      id, email, name, role, active, can_verify, personal_email, auth_provider,
      last_login, created_at, tgr_push_notify, odoo_partner_id,
      user_modules!user_modules_user_id_fkey (module_id, granted)
    `)
    .order('created_at', { ascending: false })

  const { data: modules } = await supabase
    .from('modules')
    .select('*')
    .eq('active', true)
    .order('sort_order')

  return <UsersClient users={users || []} modules={modules || []} />
}
