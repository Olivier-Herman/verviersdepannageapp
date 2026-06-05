// src/app/admin/cobrowse/page.tsx
// Liste des sessions co-browsing (pending + actives).

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AppShell              from '@/components/layout/AppShell'
import AdminCobrowseListClient from './AdminCobrowseListClient'

export const dynamic = 'force-dynamic'

export default async function AdminCobrowsePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role || '')) redirect('/dashboard')

  return (
    <AppShell
      title="Co-browsing"
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userId={user.id || ''}
      userModules={user.modules || []}
    >
      <div className="p-6 max-w-5xl mx-auto">
        <AdminCobrowseListClient />
      </div>
    </AppShell>
  )
}
