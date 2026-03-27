// src/app/admin/depots/page.tsx
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import { createAdminClient } from '@/lib/supabase'
import DepotsAdminClient     from './DepotsAdminClient'

export const dynamic = 'force-dynamic'

export default async function DepotsAdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()
  const { data: depots } = await supabase
    .from('depots')
    .select('*')
    .order('sort_order')

  return <DepotsAdminClient initialDepots={depots || []} />
}
