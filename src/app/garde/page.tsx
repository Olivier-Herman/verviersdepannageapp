// src/app/garde/page.tsx
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import GardeClient           from './GardeClient'

export default async function GardePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user      = session.user as any
  const userRoles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : [])
  const allowed   = ['dispatcher', 'admin', 'superadmin'].some(r => userRoles.includes(r))
  if (!allowed) redirect('/dashboard?error=access_denied')

  return <GardeClient userName={user.name || ''} userRole={user.role || ''} />
}
