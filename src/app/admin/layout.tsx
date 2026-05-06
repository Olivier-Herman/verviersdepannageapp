import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import AdminNav from './AdminNav'
import AdminLayoutClient from './AdminLayoutClient'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const isAdmin = ['admin', 'superadmin'].includes((session.user as any).role)
  if (!isAdmin) redirect('/dashboard')

  const userName    = session.user.name ?? ''
  const userRole    = (session.user as any).role ?? ''
  const userEmail   = session.user.email ?? undefined
  const userId      = (session.user as any).id ?? undefined
  const userModules = (session.user as any).modules ?? []

  return (
    <AdminLayoutClient
      userName={userName}
      userRole={userRole}
      userEmail={userEmail}
      userId={userId}
      userModules={userModules}
    >
      <AdminNav />
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </AdminLayoutClient>
  )
}
