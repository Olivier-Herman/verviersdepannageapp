// src/lib/missions/odoo-dossier.ts
//
// Crée le dossier Odoo (Helpdesk ticket + FSM Task) pour une mission incoming.
// Idempotent : si le dossier est déjà créé (odoo_helpdesk_id présent), on retourne
// les IDs existants sans recréer.
//
// Appelé depuis :
//   - POST /api/missions/confirm  (création auto à la confirmation dispatch)
//   - POST /api/fsm/create-mission (fallback / re-création manuelle via bouton)
//   - PATCH /api/missions/[id]    (sync des modifications dispatcher vers Odoo)

import {
  createHelpdeskTicket,
  createFsmTask,
  findOrCreateFsmPartner,
  findOrCreateFsmVehicle,
  rpcFsm,
  HELPDESK_FIELDS,
  FSM_FIELDS,
} from '@/lib/odoo-fsm'
import { createAdminClient } from '@/lib/supabase'

export interface OdooDossierResult {
  ticketId:  number
  ticketUrl: string
  taskId:    number
  taskUrl:   string
  /** True si on a créé un nouveau dossier, false si on a juste retourné les IDs existants. */
  created:   boolean
}

// Équipe Helpdesk dédiée au dispatch assistance (FSM activé, créée le 2026-05-05).
// Police continue d'utiliser team 12 ("Mission Créée par Chauffeur") via /api/towsoft/create.
const HELPDESK_TEAM_ID = 14  // Dispatch Assistance

// Mapping source mission → ID partner Odoo (= compagnie d'assistance qui FACTURE).
// Le client physiquement dépanné (mission.client_name) devient le bénéficiaire,
// stocké dans la description du ticket pour traçabilité.
// IDs récupérés via API Odoo le 2026-05-05.
const ASSISTANCE_PARTNER_BY_SOURCE: Record<string, number> = {
  touring:  14,   // Touring SA
  ethias:   16,   // Ethias
  vab:      32,   // VAB
  mondial:  45,   // AWP P&C S.A. - Belgian Branch (Allianz/Mondial Assistance Belgique)
  ima:      20,   // Ima Benelux
  ipa:      34,   // Inter Partner Assistance
  // À compléter quand les partners Odoo auront été créés/identifiés :
  // vivium:   ?,
  // axa:      ?,  (#286 AXA ASSISTANCE FRANCE — vérifier si correct pour BE)
  // ardenne:  ?,
}

/**
 * Crée (ou récupère) le dossier Odoo pour une mission.
 * Lecture en autonome depuis Supabase à partir du missionId — pas besoin de passer les champs.
 */
export async function createOdooDossierForMission(
  missionId: string
): Promise<OdooDossierResult> {
  const sb = createAdminClient()

  const { data: mission, error } = await sb
    .from('incoming_missions')
    .select('*')
    .eq('id', missionId)
    .maybeSingle()
  if (error)   throw new Error(`Erreur lecture mission ${missionId}: ${error.message}`)
  if (!mission) throw new Error(`Mission ${missionId} introuvable`)

  // ── Idempotence : si déjà créé, on retourne les IDs existants ────────────
  if (mission.odoo_helpdesk_id && mission.odoo_task_id) {
    return {
      ticketId:  mission.odoo_helpdesk_id,
      ticketUrl: mission.odoo_ticket_url || '',
      taskId:    mission.odoo_task_id,
      taskUrl:   mission.odoo_task_url    || '',
      created:   false,
    }
  }

  // ── Mapper le type d'intervention vers les codes FSM ─────────────────────
  const missionType = (mission.mission_type || '').toUpperCase()
  const missionTypeRaw = (mission.mission_type || '').toLowerCase()
  let interventionType: 'DSP' | 'REM_DIRECT' | 'REM_DEPOT' | 'REL' | 'DPR' = 'DSP'
  if (['REMORQUAGE', 'REM'].some(t => missionType.includes(t))) interventionType = 'REM_DIRECT'
  if (['DPR', 'DEPLACE'].some(t => missionType.includes(t)))    interventionType = 'DPR'
  if (['REL', 'RELIVR'].some(t => missionType.includes(t)))     interventionType = 'REL'

  // Pour DSP / réparation sur place / trajet vide → pas de destination, le véhicule
  // reste sur place ou le déplacement est interne. On évite d'envoyer une destination
  // potentiellement parasite (si le parser en a trouvé une à tort, par exemple).
  const noDestinationTypes = ['depannage', 'reparation_place', 'trajet_vide']
  const skipDestination = noDestinationTypes.includes(missionTypeRaw)

  // ── Dépôt de départ (pour calcul KM aller/retour côté assistance) ────────
  let depotDepartLabel = ''
  if (mission.depot_depart_id) {
    const { data: depot } = await sb
      .from('depots').select('name, address').eq('id', mission.depot_depart_id).maybeSingle()
    if (depot) depotDepartLabel = `${depot.name} — ${depot.address}`
  }

  // ── Chauffeur si assigné ──────────────────────────────────────────────────
  let chauffeurName = ''
  if (mission.assigned_to) {
    const { data: driver } = await sb
      .from('users').select('name').eq('id', mission.assigned_to).maybeSingle()
    chauffeurName = driver?.name || ''
  }

  // ── Partner Odoo : compagnie d'assistance (= client à FACTURER) ──────────
  // Priorité :
  //  1. billed_to_id (lien explicite choisi par le dispatcher dans /dispatch/[id])
  //  2. mapping source → partner connu (touring=14, ethias=16, vab=32, …)
  //  3. fallback findOrCreate sur le billed_to_name (ou client_name si vide)
  const sourceLower = (mission.source || '').toLowerCase()
  let partnerId: number | undefined = mission.billed_to_id || undefined

  if (partnerId) {
    console.log(`[FSM] Partner facturation = lien explicite dispatcher (#${partnerId})`)
  } else {
    partnerId = ASSISTANCE_PARTNER_BY_SOURCE[sourceLower]
    if (partnerId) {
      console.log(`[FSM] Partner facturation = compagnie ${sourceLower.toUpperCase()} (#${partnerId})`)
    } else {
      try {
        partnerId = await findOrCreateFsmPartner({
          name:  mission.billed_to_name || mission.client_name,
          phone: mission.client_phone,
        })
      } catch (e: any) {
        console.warn(`[FSM] Partner non créé pour mission ${missionId}: ${e.message}`)
      }
    }
  }

  // ── Description enrichie : bénéficiaire = client physiquement dépanné ────
  // (different de partnerId qui est le payeur/compagnie d'assistance)
  const beneficiaryParts: string[] = []
  if (mission.client_name)  beneficiaryParts.push(`Bénéficiaire : ${mission.client_name}`)
  if (mission.client_phone) beneficiaryParts.push(`Tél : ${mission.client_phone}`)
  if (mission.client_email) beneficiaryParts.push(`Email : ${mission.client_email}`)
  const beneficiaryLine = beneficiaryParts.length > 0
    ? beneficiaryParts.join(' — ') + '\n\n'
    : ''

  const enrichedDescription = beneficiaryLine + (mission.incident_description || '')

  // ── Détection mode TEST : si [TEST] dans description ou notes, on préfixe partout ──
  // Permet de filtrer/nettoyer facilement les missions de test côté Odoo prod.
  const rawTextForTestDetect = [
    mission.incident_description || '',
    mission.notes || '',
    mission.parsed_data?.notes || '',
  ].join(' ')
  const isTest = /\[TEST\]/i.test(rawTextForTestDetect)
  const testPrefix = isTest ? '[TEST] ' : ''

  // ── Helpdesk ticket (dossier chapeau) ─────────────────────────────────────
  const { ticketId, ticketUrl } = await createHelpdeskTicket({
    supabaseId:    mission.id,
    dossierNumber: mission.dossier_number || '',
    source:        mission.source || 'PRIVÉ',
    clientName:    mission.client_name  || 'Client inconnu',
    partnerId,
    description:   enrichedDescription,
    teamId:        HELPDESK_TEAM_ID,
    vehiclePlate:  mission.vehicle_plate || '',
    city:          mission.incident_city || '',
    namePrefix:    testPrefix,
  })

  // ── Véhicule Parc Auto Odoo ──────────────────────────────────────────────
  let vehicleId: number | undefined
  if (mission.vehicle_plate) {
    try {
      const vId = await findOrCreateFsmVehicle({
        licensePlate: mission.vehicle_plate,
        brandName:    mission.vehicle_brand   || '',
        modelName:    mission.vehicle_model   || '',
        vin:          mission.vehicle_vin     || '',
        fuel:         mission.vehicle_fuel    || '',
        gearbox:      mission.vehicle_gearbox || '',
      })
      if (vId) vehicleId = vId
    } catch (e: any) {
      console.warn(`[FSM] Véhicule non trouvé/créé pour mission ${missionId}: ${e.message}`)
    }
  }

  // ── FSM Task liée au ticket (peut retourner null si projet FSM/stages absents) ──
  const incidentFull = [mission.incident_address, mission.incident_city].filter(Boolean).join(', ')
  const fsmResult = await createFsmTask({
    supabaseId:          mission.id,
    helpdeskTicketId:    ticketId,
    interventionType,
    interventionContext: 'STANDARD',
    source:              (mission.source || 'PRIVÉ').toUpperCase(),
    dossierNumber:       mission.dossier_number || '',
    chauffeurName,
    chauffeurSupabaseId: mission.assigned_to || '',
    vehicleId,
    clientName:          mission.client_name || 'Client inconnu',
    partnerId,
    vehicleInfo:         [mission.vehicle_plate, mission.vehicle_brand, mission.vehicle_model]
                         .filter(Boolean).join(' '),
    incidentAddress:     incidentFull,
    destinationAddress:  skipDestination ? '' : (mission.destination_address || ''),
    depotDepart:         depotDepartLabel,
    description:         mission.incident_description || '',
    beneficiaryName:     mission.client_name  || '',
    beneficiaryPhone:    mission.client_phone || '',
    namePrefix:          testPrefix,
  })

  const taskId  = fsmResult?.taskId  || null
  const taskUrl = fsmResult?.taskUrl || ''

  // ── Sauvegarde des IDs Odoo ──────────────────────────────────────────────
  // odoo_vehicle_id : crucial pour que le PDF mission puisse etre attache a
  // la fiche vehicule, et pour eviter que l'UI demande au dispatcher de
  // re-lier le vehicule a chaque ouverture.
  const update: any = {
    odoo_helpdesk_id: ticketId,
    odoo_ticket_url:  ticketUrl,
  }
  if (taskId)    update.odoo_task_id    = taskId
  if (taskUrl)   update.odoo_task_url   = taskUrl
  if (vehicleId) update.odoo_vehicle_id = vehicleId
  await sb.from('incoming_missions').update(update).eq('id', missionId)

  if (taskId) {
    console.log(`[FSM] Dossier créé pour mission ${missionId}: ticket #${ticketId}, task #${taskId}`)
  } else {
    console.log(`[FSM] Dossier partiel pour mission ${missionId}: ticket #${ticketId} OK, task FSM ignorée (config Odoo incomplète)`)
  }

  return {
    ticketId,
    ticketUrl,
    taskId:  taskId  || 0,
    taskUrl: taskUrl || '',
    created: true,
  }
}

/**
 * Synchronise les modifications d'une mission vers son helpdesk + task FSM Odoo.
 * Appelé après chaque PATCH dispatcher pour garder Odoo à jour avec les modifs
 * (adresses, bénéficiaire, dépôt, partner, description, etc.).
 *
 * Best effort : ne plante pas si une partie échoue.
 * No-op si la mission n'a pas encore de dossier Odoo créé.
 */
export async function updateOdooDossierForMission(missionId: string): Promise<{ updated: boolean }> {
  const sb = createAdminClient()
  const { data: mission } = await sb
    .from('incoming_missions').select('*').eq('id', missionId).maybeSingle()
  if (!mission) return { updated: false }
  if (!mission.odoo_helpdesk_id && !mission.odoo_task_id) return { updated: false }

  // Recalcul partner_id (lien explicite > mapping source > findOrCreate)
  const sourceLower = (mission.source || '').toLowerCase()
  let partnerId: number | undefined = mission.billed_to_id || ASSISTANCE_PARTNER_BY_SOURCE[sourceLower]
  if (!partnerId && mission.billed_to_name) {
    try {
      partnerId = await findOrCreateFsmPartner({ name: mission.billed_to_name, phone: mission.client_phone })
    } catch {}
  }

  // Détection [TEST] (réutilise la logique de la création)
  const rawTextForTestDetect = [
    mission.incident_description || '',
    mission.notes || '',
    mission.parsed_data?.notes || '',
  ].join(' ')
  const isTest = /\[TEST\]/i.test(rawTextForTestDetect)
  const testPrefix = isTest ? '[TEST] ' : ''

  // Bénéficiaire dans la description
  const beneficiaryParts: string[] = []
  if (mission.client_name)  beneficiaryParts.push(`Bénéficiaire : ${mission.client_name}`)
  if (mission.client_phone) beneficiaryParts.push(`Tél : ${mission.client_phone}`)
  if (mission.client_email) beneficiaryParts.push(`Email : ${mission.client_email}`)
  const beneficiaryLine = beneficiaryParts.length > 0
    ? beneficiaryParts.join(' — ') + '\n\n'
    : ''
  const enrichedDescription = beneficiaryLine + (mission.incident_description || '')

  // Filtrage destination pour DSP
  const noDestinationTypes = ['depannage', 'reparation_place', 'trajet_vide']
  const skipDestination = noDestinationTypes.includes((mission.mission_type || '').toLowerCase())

  // Adresse incident composée
  const incidentFull = [mission.incident_address, mission.incident_city].filter(Boolean).join(', ')

  // Dépôt label
  let depotDepartLabel = ''
  if (mission.depot_depart_id) {
    const { data: depot } = await sb
      .from('depots').select('name, address').eq('id', mission.depot_depart_id).maybeSingle()
    if (depot) depotDepartLabel = `${depot.name} — ${depot.address}`
  }

  // ── Update helpdesk ticket ───────────────────────────────────────────────
  if (mission.odoo_helpdesk_id) {
    try {
      const update: any = {
        name:        testPrefix + 'Etiquette automatique',
        description: enrichedDescription,
      }
      if (partnerId)             update.partner_id                       = partnerId
      if (mission.source)        update[HELPDESK_FIELDS.source]          = mission.source.toUpperCase()
      if (mission.dossier_number) update[HELPDESK_FIELDS.dossier_number] = mission.dossier_number
      await rpcFsm('helpdesk.ticket', 'write', [[mission.odoo_helpdesk_id], update])
      console.log(`[FSM] Helpdesk #${mission.odoo_helpdesk_id} synchronisé`)
    } catch (e: any) {
      console.error('[FSM] Update helpdesk échoué:', e.message)
    }
  }

  // ── Update FSM task ──────────────────────────────────────────────────────
  if (mission.odoo_task_id) {
    try {
      const taskName = (testPrefix) + [
        mission.vehicle_plate,
        mission.dossier_number,
        mission.incident_city,
      ].filter(Boolean).join(' - ')

      const update: any = {
        name: taskName || 'Mission',
        description: [
          mission.incident_description || '',
          incidentFull ? `📍 Prise en charge: ${incidentFull}` : '',
          !skipDestination && mission.destination_address ? `🏁 Destination: ${mission.destination_address}` : '',
        ].filter(Boolean).join('\n'),
      }
      if (partnerId)                          update.partner_id                       = partnerId
      if (mission.source)                     update[FSM_FIELDS.source]               = mission.source.toUpperCase()
      if (mission.dossier_number)             update[FSM_FIELDS.dossier_number]       = mission.dossier_number
      if (incidentFull)                       update[FSM_FIELDS.adresse_intervention] = incidentFull
      if (!skipDestination && mission.destination_address) {
        update[FSM_FIELDS.adresse_destination] = mission.destination_address
      } else if (skipDestination) {
        update[FSM_FIELDS.adresse_destination] = ''
      }
      if (mission.client_name)                update[FSM_FIELDS.beneficiaire_name]    = mission.client_name
      if (mission.client_phone)               update[FSM_FIELDS.beneficiaire_phone]   = mission.client_phone
      if (depotDepartLabel)                   update[FSM_FIELDS.depot_depart]         = depotDepartLabel

      await rpcFsm('project.task', 'write', [[mission.odoo_task_id], update])
      console.log(`[FSM] Task #${mission.odoo_task_id} synchronisée`)
    } catch (e: any) {
      console.error('[FSM] Update task échoué:', e.message)
    }
  }

  return { updated: true }
}
