// src/app/mission/[id]/page.tsx
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import DriverClient          from './DriverClient'
import SncMissionFiche       from './SncMissionFiche'
import { getDefaultParcZone } from '@/lib/missions/parc-default'
import { flux2Enabled }        from '@/lib/cloture/gating'
import { isPreviewOn, flagAppliesToMission } from '@/lib/feature-flags'

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

  // Beta clôture Touring côté chauffeur : superadmin + Franck uniquement. Olivier 2026-08-06.
  const touringBeta = (currentUser as any).role === 'superadmin'
    || (session.user.email || '').toLowerCase() === 'bose4845@gmail.com'

  // params.id accepte UUID OU mission_number numerique (Olivier 2026-05-26).
  const idIsNumeric = /^\d+$/.test(params.id)
  const { data: mission } = idIsNumeric
    ? await supabase.from('incoming_missions').select('*').eq('mission_number', Number(params.id)).single()
    : await supabase.from('incoming_missions').select('*').eq('id', params.id).single()

  if (!mission) redirect('/dashboard')

  // FLUX 2 — clôture unifiée « Action ». Deux axes : testeur ET assistance ouverte
  // (flag `flux2_<assistance>` en base). Faux ⇒ le chauffeur garde l'écran actuel.
  const flux2 = await flux2Enabled(currentUser as any, mission as any)

  // Refonte flux sur place (écran « Qu'est-ce qu'on fait ? » + scénario + type +
  // encaissement couplé). Flag off ⇒ le chauffeur garde l'écran actuel. 2026-08-20.
  //
  // ⚠️ Et une mission DÉJÀ COMMENCÉE garde son parcours (Olivier 2026-08-21) :
  // changer les écrans sous les doigts d'un chauffeur au bord de la route, c'est
  // la meilleure façon de le bloquer. La coupure se fait sur l'acceptation.
  const onsiteV2 = await flagAppliesToMission('driver_onsite_v2', (currentUser as any).role, mission as any)

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
  // Olivier 2026-07-09 : SncMissionFiche (parc/finaliser, SANS pointage) est la
  // fiche « brouillon paiement immédiat » créée par le module chauffeur sur le
  // terrain (route police/draft → seule à poser awaiting_payment=true). Une
  // mission SNC/SC ENVOYÉE PAR LE DISPATCH (ou une mission d'assistance reclassée
  // en Siabis non couvert) n'a PAS awaiting_payment → elle doit garder le flux
  // normal DriverClient avec pointage (accepter → en route → sur place).
  const isDriverDraft = mission.awaiting_payment === true
  const isSncFiche    = isSncSource && isDriverDraft && !hasStartedDelivery

  // « Afficher au client » (écran comptoir) = action DISPATCH → retirée du flux
  // chauffeur (elle reste sur la fiche dispatch). Olivier 2026-08-20.
  const officePush = null

  if (isSncFiche && !forceLegacy) {
    return (
      <>
        {officePush}
        <SncMissionFiche
          mission={mission}
          currentUserId={currentUser.id}
          isReadOnly={isStaff && !isDriverOfMission}
          navApp={currentUser.nav_app || 'gmaps'}
        />
      </>
    )
  }

  // Parc par défaut de la source (Administration → Sources de mission) : zone
  // suggérée à la mise en parc côté chauffeur (« catalog strict »).
  const defaultParcZone = await getDefaultParcZone(mission.source, supabase)

  // Relivraison : remarque de clôture du REM PARENT → alerte obligatoire sur
  // l'écran chauffeur (ex « Ne pas démarrer le véhicule »). Olivier 2026-08-10.
  // Et la PANNE relevée à l'enlèvement : « sur une fiche de relivraison il
  // faudrait que le chauffeur puisse voir les codes panne renseignés par la
  // mission parent, afin qu'il sache ce qu'a le véhicule qu'il va charger »
  // (Olivier 2026-08-18).
  let parentClosingNote: string | null = null
  let parentPanne: string | null = null
  if (mission.parent_mission_id) {
    const { data: parent } = await supabase.from('incoming_missions')
      .select('closing_notes, panne_motif').eq('id', mission.parent_mission_id).maybeSingle()
    parentClosingNote = parent?.closing_notes || null
    const key = (parent as any)?.panne_motif || ''
    if (key) {
      const { findMotif } = await import('@/lib/cloture/motifs')
      parentPanne = findMotif('remorquage', key)?.label || findMotif('mobilite', key)?.label || null
    }
  }

  return (
    <>
      {officePush}
      <DriverClient
        mission={mission}
        currentUserId={currentUser.id}
        userRole={(currentUser as any).role}
        isReadOnly={isStaff && !isDriverOfMission}
        navApp={currentUser.nav_app || 'gmaps'}
        defaultParcZone={defaultParcZone}
        touringBeta={touringBeta}
        flux2={flux2}
        onsiteV2={onsiteV2}
        parentPanne={parentPanne}
        parentClosingNote={parentClosingNote}
      />
    </>
  )
}
