// src/app/mission/[id]/page.tsx
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import DriverClient          from './DriverClient'

interface Props { params: { id: string } }

export default async function MissionDriverPage({ params }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/api/auth/signin')

  const supabase = createAdminClient()

  const { data: currentUser } = await supabase
    .from('users').select('id, role, nav_app').eq('email', session.user.email!).single()
  if (!currentUser) redirect('/dashboard')

  const { data: mission } = await supabase
    .from('incoming_missions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!mission) redirect('/dashboard')

  const isDriverOfMission = mission.assigned_to === currentUser.id
  const isStaff = ['admin', 'superadmin', 'dispatcher'].includes(currentUser.role)
  if (!isDriverOfMission && !isStaff) redirect('/dashboard')

  return (
    <DriverClient
      mission={mission}
      currentUserId={currentUser.id}
      isReadOnly={isStaff && !isDriverOfMission}
      navApp={currentUser.nav_app || 'gmaps'}
    />
  )
}
