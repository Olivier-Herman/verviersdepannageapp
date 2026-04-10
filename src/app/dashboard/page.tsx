// src/app/dashboard/page.tsx
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import DashboardClient       from './DashboardClient'

export const dynamic  = 'force-dynamic'
export const revalidate = 0

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()
  const user = session.user as any

  // Récupérer les raccourcis d'appel
  const { data: shortcuts } = await supabase
    .from('call_shortcuts')
    .select('label, phone')
    .order('sort_order')

  // Vérifier si le chauffeur a un towsoft_name configuré
  const { data: dbUser } = await supabase
    .from('users')
    .select('towsoft_name')
    .eq('email', user.email!)
    .maybeSingle()

  return (
    <DashboardClient
      session={session}
      callShortcuts={shortcuts || []}
      hasTowsoft={!!dbUser?.towsoft_name}
      currentUserRole={user.role || 'driver'}
    />
  )
}
