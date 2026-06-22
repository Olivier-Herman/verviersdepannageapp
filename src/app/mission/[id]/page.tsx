// src/app/mission/[id]/page.tsx
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import DriverClient          from './DriverClient'
import SncMissionFiche       from './SncMissionFiche'
import { getDefaultParcZone } from '@/lib/missions/parc-default'

// Olivier 2026-06-03 : force-dynamic obligatoire — sinon Next.js peut cacher
// la fiche mission cote serveur, et apres action driver (load_vehicle, etc.)
// le reload retourne l ancien state (loaded_at=null) → page.tsx route encore
// vers SncMissionFiche → boucle.
export const dynamic = 'force-dynamic'
export const revalidate = 0

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
  // Olivier 2026-06-03 : une fois que le chauffeur a commence le chargement
  // (loaded_at set) OU que la mission est en livraison/parked/cloturee, on
  // BASCULE DEFINITIVEMENT sur DriverClient. Plus de retour SncMissionFiche
  // sinon le bouton "Charger et livrer" reapparait et cree une boucle apres
  // chaque action chauffeur (Vehicule charge ↔ Arrivee destination).
  // ?legacy=1 force aussi DriverClient (legacy escape hatch).
  const isSncSource = mission.source === 'police_snc' || mission.source === 'sia_couvert'
  // Olivier 2026-06-03 : la mission reste en BROUILLON (SncMissionFiche)
  // tant que le solde n est pas a zero. Des que (amount_to_collect - payment_amount) == 0,
  // la mission devient definitive et bascule sur DriverClient.
  const amountRequired = Number(mission.amount_to_collect || 0)
  const amountPaid     = Number(mission.payment_amount    || 0)
  const isFullyPaid    = amountRequired > 0 && amountPaid + 0.01 >= amountRequired
  const hasPaidAndFinalized = mission.awaiting_payment === false && isFullyPaid
  const hasStartedDelivery =
       !!mission.loaded_at
    || mission.status === 'delivering'
    || mission.status === 'parked'
    || mission.status === 'completed'
    || mission.status === 'to_invoice'
    || hasPaidAndFinalized
  const forceLegacy = searchParams?.legacy === '1'
  const isSncFiche  = isSncSource && !hasStartedDelivery

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

  // Parc par défaut de la source (Administration → Sources de mission) : zone
  // suggérée à la mise en parc côté chauffeur (« catalog strict »).
  const defaultParcZone = await getDefaultParcZone(mission.source, supabase)

  return (
    <DriverClient
      mission={mission}
      currentUserId={currentUser.id}
      isReadOnly={isStaff && !isDriverOfMission}
      navApp={currentUser.nav_app || 'gmaps'}
      defaultParcZone={defaultParcZone}
    />
  )
}
