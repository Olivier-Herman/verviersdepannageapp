import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import AdminNav from './AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const isAdmin = ['admin', 'superadmin'].includes((session.user as any).role)
  if (!isAdmin) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-[#0F0F0F] flex flex-col lg:flex-row">
      <AdminNav />
      <main className="flex-1 overflow-y-auto pb-24 lg:pb-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  )
}
