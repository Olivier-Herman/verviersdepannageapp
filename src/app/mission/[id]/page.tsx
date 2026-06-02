// src/app/mission/[id]/page.tsx
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import DriverClient          from './DriverClient'
import SncMissionFiche       from './SncMissionFiche'

interface Props {
  params: { id: string }
  searchParams?: { legacy?: string }
}

export default async function MissionDriverPage({ params, searchParams }: Props) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/api/auth/signin')

  const supabase = createAdminClient()

  const { data: currentUser } = await supabase
    .from('users').select('id, role, nav_app').eq('email', session.user.email!).single()
  if (!currentUser) redirect('/dashboard')

  // params.id accepte UUID OU mission_number numerique (Olivier 2026-05-26).
  const idIsNumeric = /^\d+$/.test(params.id)
  const { data: mission } = idIsNumeric
    ? await supabase.from('incoming_missions').select('*').eq('mission_number', Number(params.id)).single()
    : await supabase.from('incoming_missions').select('*').eq('id', params.id).single()

  if (!mission) redirect('/dashboard')

  const isDriverOfMission = mission.assigned_to === currentUser.id
  const isStaff = ['admin', 'superadmin', 'dispatcher'].includes(currentUser.role)
  if (!isDriverOfMission && !isStaff) redirect('/dashboard')

  // Olivier 2026-06-02 PM — Fiche dediee SNC/SC reclassifiees.
  // Mirror visuel de PoliceClient pour les missions police_snc / sia_couvert
  // recues depuis un canal externe. ?legacy=1 force le rendu DriverClient
  // (necessaire pour le wizard photos / mise en parc / cloture complets
  // pas encore portes).
  const isSncFiche  = mission.source === 'police_snc' || mission.source === 'sia_couvert'
  const forceLegacy = searchParams?.legacy === '1'

  if (isSncFiche && !forceLegacy) {
    return (
      <SncMissionFiche
        mission={mission}
        currentUserId={currentUser.id}
        isReadOnly={isStaff && !isDriverOfMission}
        navApp={currentUser.nav_app || 'gmaps'}
      />
    )
  }

  return (
    <DriverClient
      mission={mission}
      currentUserId={currentUser.id}
      isReadOnly={isStaff && !isDriverOfMission}
      navApp={currentUser.nav_app || 'gmaps'}
    />
  )
}
