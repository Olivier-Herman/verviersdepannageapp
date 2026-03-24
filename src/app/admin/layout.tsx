import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import AppShell from '@/components/layout/AppShell'
import AdminNav from './AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const isAdmin = ['admin', 'superadmin'].includes((session.user as any).role)
  if (!isAdmin) redirect('/dashboard')

  const supabase = createAdminClient()
  const { data: userModulesDb } = await supabase
    .from('user_modules')
    .select('module_id')
    .eq('user_id', (session.user as any).id)
    .eq('granted', true)

  return (
    <AppShell
      title="Administration"
      userRole={(session.user as any).role}
      userName={session.user.name ?? ''}
      userModules={(userModulesDb || []).map(m => m.module_id)}
    >
      <AdminNav />
      <div className="px-4 lg:px-8 py-6 pb-24 lg:pb-10">
        {children}
      </div>
    </AppShell>
  )
}
