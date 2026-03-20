import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import AdminNav from './AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const isAdmin = ['admin', 'superadmin'].includes(session.user.role)
  if (!isAdmin) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-[#0F0F0F] max-w-md mx-auto flex flex-col">
      <AdminNav />
      <main className="flex-1 overflow-y-auto pb-24">
        {children}
      </main>
    </div>
  )
}
