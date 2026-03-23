import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import ProfileClient from './ProfileClient'

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()

  // Chercher par ID d'abord, puis par email en fallback
  const userId = (session.user as any).id
  let query = supabase
    .from('users')
    .select('id, name, email, role, can_verify, verify_pin_hash')

  const { data: user } = userId
    ? await query.eq('id', userId).single()
    : await query.ilike('email', session.user.email!).single()

  return <ProfileClient user={user} />
}
