import { createAdminClient } from '@/lib/supabase'
import UsersClient from './UsersClient'

export default async function UsersPage() {
  const supabase = createAdminClient()

  const { data: users } = await supabase
    .from('users')
    .select(`
      id, email, name, role, active, last_login, created_at,
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
