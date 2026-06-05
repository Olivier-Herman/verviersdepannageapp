// src/app/admin/cobrowse/[id]/page.tsx
// Viewer rrweb live d une session co-browsing.

import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import AppShell              from '@/components/layout/AppShell'
import CobrowseViewerClient  from './CobrowseViewerClient'

export const dynamic = 'force-dynamic'

export default async function CobrowseViewerPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role || '')) redirect('/dashboard')

  return (
    <AppShell
      title="Session d aide"
      backHref="/admin/cobrowse"
      userRole={user.role}
      userName={user.name || ''}
      userEmail={user.email || ''}
      userId={user.id || ''}
      userModules={user.modules || []}
    >
      <CobrowseViewerClient sessionId={params.id} />
    </AppShell>
  )
}
