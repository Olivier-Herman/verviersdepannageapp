import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import CashClient from './CashClient'

export default async function CashPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()
  const { data: user } = await supabase
    .from('users').select('id').eq('email', session.user.email).single()

  return <CashClient userName={session.user.name || session.user.email || ''} driverId={user?.id || ''} />
}
