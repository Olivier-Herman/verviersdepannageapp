import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import ProfileClient from './ProfileClient'

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email, role, can_verify, verify_pin_hash')
    .eq('email', session.user.email)
    .single()

  return <ProfileClient user={user} />
}
