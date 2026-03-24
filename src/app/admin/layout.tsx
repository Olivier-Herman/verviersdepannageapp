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

  const userName = session.user.name ?? ''
  const userRole = (session.user as any).role ?? ''

  return (
    <AdminLayoutClient userName={userName} userRole={userRole}>
      <AdminNav />
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </AdminLayoutClient>
  )
}
