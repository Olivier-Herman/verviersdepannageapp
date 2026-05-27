// src/app/qr/mission/[id]/page.tsx
//
// Page d atterrissage quand un chauffeur scanne le QR d une etiquette REL
// collee sur un vehicule en parc. Affiche le contexte mission + 2 actions :
//   - Consulter le dossier (vue chauffeur)
//   - Relivrer le vehicule (cree la REL fille + assigne le chauffeur scanneur)
//
// Eligibilite pour l action "Relivrer" :
//   - REM+REL en parc (assurances)
//   - Siabis Couvert scenario rem_depot en parc
//   - Siabis Non Couvert scenario rem_depot en parc
//
// Si une REL fille existe deja avec un autre chauffeur assigne, l UI propose
// une confirmation pour reassigner (cas de remplacement).

import { redirect, notFound } from 'next/navigation'
import { getServerSession }   from 'next-auth'
import { authOptions }        from '@/lib/auth'
import { createAdminClient }  from '@/lib/supabase'
import QrMissionClient        from './QrMissionClient'

export const dynamic = 'force-dynamic'

export default async function QrMissionPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) {
    // Redirect vers login en gardant le retour vers cette page après auth
    redirect(`/login?callbackUrl=${encodeURIComponent(`/qr/mission/${params.id}`)}`)
  }
  const user = session.user as any

  const sb = createAdminClient()

  // Lecture de la mission scannee.
  // params.id accepte UUID OU mission_number numerique (Olivier 2026-05-27).
  // Le QR sur l etiquette utilise mission_number lisible (8 chiffres).
  // Note : on construit 2 query separees pour eviter toute mutation du query
  // builder Supabase JS entre les 2 appels.
  const idIsNumeric = /^\d+$/.test(params.id)
  const selectCols = `
    id, mission_number, external_id, dossier_number, source, mission_type, incident_type,
    status, snc_scenario,
    vehicle_plate, vehicle_brand, vehicle_model,
    client_name, billed_to_name,
    destination_address, destination_city,
    assigned_to, parent_mission_id, completed_at
  `
  const lookup = idIsNumeric
    ? await sb.from('incoming_missions').select(selectCols).eq('mission_number', Number(params.id)).maybeSingle()
    : await sb.from('incoming_missions').select(selectCols).eq('id', params.id).maybeSingle()
  const { data: mission, error } = lookup

  if (error) {
    console.error('[qr/mission] erreur SQL pour', params.id, ':', error.message)
    notFound()
  }
  if (!mission) {
    console.warn('[qr/mission] mission introuvable :', params.id, '(numeric:', idIsNumeric, ')')
    notFound()
  }

  // Detecte une REL fille existante pour ce parent (idempotence)
  const { data: existingRel } = await sb
    .from('incoming_missions')
    .select('id, mission_number, external_id, status, assigned_to, dossier_number')
    .eq('parent_mission_id', mission.id)
    .eq('incident_type', 'relivraison')
    .maybeSingle()

  // Si une REL fille existe deja, on charge aussi le chauffeur assigne
  let existingRelAssignee: { id: string; name: string } | null = null
  if (existingRel?.assigned_to) {
    const { data: assignee } = await sb
      .from('users')
      .select('id, name')
      .eq('id', existingRel.assigned_to)
      .single()
    existingRelAssignee = assignee || null
  }

  // Detecte si la mission scannee est eligible pour creer/prendre une REL
  const isParked = mission.status === 'parked'
  const isSiabisRemDepot = ['police_snc', 'sia_couvert'].includes(mission.source || '')
                        && mission.snc_scenario === 'rem_depot'
  const isRemRelMission = mission.mission_type === 'REM+REL'
  const isElligibleForRel = isParked && (isRemRelMission || isSiabisRemDepot)

  // Determine le role du scanneur pour le bouton "Consulter le dossier"
  const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const isDispatcher = userRoles.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))
  const isDriver     = userRoles.includes('driver')
  // URL de consultation : dispatchers vont sur la fiche dispatch, drivers
  // sur la fiche mission chauffeur. Si on a a la fois driver et admin,
  // on privilegie la vue chauffeur (cas mobile dans le parc).
  const consultUrl = isDriver
    ? `/mission/${mission.id}`
    : `/dispatch/${mission.id}`

  return (
    <QrMissionClient
      mission={{
        id:                 mission.id,
        mission_number:     mission.mission_number,
        external_id:        mission.external_id,
        dossier_number:     mission.dossier_number,
        source:             mission.source,
        mission_type:       mission.mission_type,
        status:             mission.status,
        vehicle_plate:      mission.vehicle_plate,
        vehicle_brand:      mission.vehicle_brand,
        vehicle_model:      mission.vehicle_model,
        client_name:        mission.client_name,
        billed_to_name:     mission.billed_to_name,
        destination_address: mission.destination_address,
        destination_city:    mission.destination_city,
      }}
      existingRel={existingRel ? {
        id:             existingRel.id,
        mission_number: existingRel.mission_number,
        external_id:    existingRel.external_id,
        status:         existingRel.status,
        assigned_to:    existingRel.assigned_to,
        assigneeName:   existingRelAssignee?.name || null,
      } : null}
      currentUser={{
        id:    user.id,
        name:  user.name || '',
        isDriver,
      }}
      consultUrl={consultUrl}
      isElligibleForRel={isElligibleForRel}
    />
  )
}
