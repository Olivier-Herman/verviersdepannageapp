// src/app/circuit/course/page.tsx — Week-ends de course (circuit)
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { redirect }          from 'next/navigation'
import RaceWeekendManager    from '../RaceWeekendManager'

export const dynamic = 'force-dynamic'

export default async function CoursePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  const user = session.user as any
  const roles = Array.isArray(user.roles) ? user.roles : []
  const allowed = ['dispatcher', 'admin', 'superadmin']
  if (!(allowed.includes(user.role) || roles.some((r: string) => allowed.includes(r)))) redirect('/dashboard')

  return <RaceWeekendManager userRole={user.role || ''} userName={user.name || ''} userEmail={user.email || ''} userModules={user.modules || []} />
}
