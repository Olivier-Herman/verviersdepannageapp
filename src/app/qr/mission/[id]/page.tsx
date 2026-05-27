// src/app/qr/mission/[id]/page.tsx
//
// Hub unifie de mission scannee depuis le QR de l etiquette parc.
// Olivier 2026-05-27 : porte toutes les fonctions de l ancienne page /v/[id]
// pour ne pas regresser, avec les permissions par fonction :
//
//   - Carte vehicule riche (zone, date entree, motif, VIN, etc.) - tous
//   - Restituer (avec paiement)   - tous users auth
//   - Restituer sans frais        - tous users auth
//   - Relivrer (REM+REL)          - drivers
//   - Transferer vers une zone    - admin / superadmin / fourriere
//   - Envoyer au Domaine          - admin / superadmin / fourriere
//   - Scratch / Mettre en epave   - admin / superadmin / fourriere
//   - Imprimer une etiquette      - admin / superadmin / fourriere
//   - Ouvrir dans Odoo            - users avec odoo_api_key non vide
//   - Consulter le dossier        - tous

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
  // SELECT * pour eviter toute issue de syntax sur le select multilignes.
  const idIsNumeric = /^\d+$/.test(params.id)
  console.log('[qr/mission] lookup id=', params.id, 'isNumeric=', idIsNumeric)

  const lookup = idIsNumeric
    ? await sb.from('incoming_missions').select('*').eq('mission_number', Number(params.id)).maybeSingle()
    : await sb.from('incoming_missions').select('*').eq('id', params.id).maybeSingle()
  const { data: mission, error } = lookup

  if (error) {
    console.error('[qr/mission] SQL ERROR for', params.id, ':', JSON.stringify(error))
    notFound()
  }
  if (!mission) {
    console.warn('[qr/mission] mission NOT FOUND :', params.id, '(numeric:', idIsNumeric, ')')
    notFound()
  }
  console.log('[qr/mission] mission found :', mission.id, '#' + mission.mission_number, 'status:', mission.status)

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

  // Determine roles + modules + odoo_api_key du scanneur pour les permissions par fonction.
  const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const userModules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isDriver = userRoles.includes('driver')

  // Recupere odoo_api_key de l user (utilise pour bouton "Ouvrir dans Odoo")
  const { data: dbUser } = await sb
    .from('users')
    .select('odoo_api_key')
    .eq('id', user.id || '')
    .maybeSingle()
  const hasOdooKey = Boolean(dbUser?.odoo_api_key)

  // Permissions par fonction (Olivier 2026-05-27)
  const isAdmin = userRoles.some(r => ['admin', 'superadmin'].includes(r))
  const isDispatcher = userRoles.includes('dispatcher')
  const hasFourriereModule = userModules.includes('fourriere')
  const canFourriereActions = isAdmin || hasFourriereModule  // Transferer/Domaine/Scratch/Imprimer
  const canOpenOdoo = hasOdooKey
  const canConsulterDossier = isAdmin || isDispatcher          // Olivier 2026-05-27

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
        vehicle_vin:        mission.vehicle_vin,
        vehicle_brand:      mission.vehicle_brand,
        vehicle_model:      mission.vehicle_model,
        client_name:        mission.client_name,
        billed_to_name:     mission.billed_to_name,
        incident_address:   mission.incident_address,
        incident_city:      mission.incident_city,
        destination_address: mission.destination_address,
        destination_city:    mission.destination_city,
        // Donnees fourriere supplementaires (carte enrichie)
        parc_zone_key:      mission.parc_zone_key,
        parc_row_number:    mission.parc_row_number,
        parc_slot_index:    mission.parc_slot_index,
        intervention_date:  mission.intervention_date,
        received_at:        mission.received_at,
        parked_at:          mission.parked_at,
        incident_type:      mission.incident_type,
        // Pour bouton "Ouvrir dans Odoo" + appels endpoints /api/helpdesk/[ticketId]/...
        odoo_ticket_id:     mission.odoo_ticket_id || null,
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
      permissions={{
        canFourriereActions,
        canOpenOdoo,
        canConsulterDossier,
      }}
      consultUrl={consultUrl}
      isElligibleForRel={isElligibleForRel}
    />
  )
}
