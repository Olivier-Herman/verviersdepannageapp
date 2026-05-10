// Module Relance Client — entry point.
//
// Garde côté serveur : 1) session NextAuth, 2) module 'relances' actif
// dans user_modules pour ce user. Pas de fallback admin/superadmin —
// convention "modules par utilisateur, pas par rôle".

import { getServerSession }   from 'next-auth'
import { redirect }           from 'next/navigation'
import { authOptions }        from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import RelancesClient         from './RelancesClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

export default async function RelancesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const userId   = (session.user as any).id as string
  const supabase = createAdminClient()

  const { data: moduleRow } = await supabase
    .from('user_modules')
    .select('granted')
    .eq('user_id',   userId)
    .eq('module_id', 'relances')
    .eq('granted',   true)
    .maybeSingle()

  if (!moduleRow) redirect('/dashboard')

  return <RelancesClient session={session} />
}
