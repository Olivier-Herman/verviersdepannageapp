// src/app/mission/police/page.tsx
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import PoliceClient         from './PoliceClient'

export default async function PolicePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()
  const { data: dbUser } = await supabase
    .from('users')
    .select('role')
    .eq('email', (session.user as any).email)
    .maybeSingle()

  return <PoliceClient userRole={dbUser?.role || 'driver'} />
}
