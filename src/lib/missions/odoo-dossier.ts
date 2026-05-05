// src/lib/missions/odoo-dossier.ts
//
// Crée le dossier Odoo (Helpdesk ticket + FSM Task) pour une mission incoming.
// Idempotent : si le dossier est déjà créé (odoo_helpdesk_id présent), on retourne
// les IDs existants sans recréer.
//
// Appelé depuis :
//   - POST /api/missions/confirm  (création auto à la confirmation dispatch)
//   - POST /api/fsm/create-mission (fallback / re-création manuelle via bouton)

import {
  createHelpdeskTicket,
  createFsmTask,
  findOrCreateFsmPartner,
  findOrCreateFsmVehicle,
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
  let interventionType: 'DSP' | 'REM_DIRECT' | 'REM_DEPOT' | 'REL' | 'DPR' = 'DSP'
  if (['REMORQUAGE', 'REM'].some(t => missionType.includes(t))) interventionType = 'REM_DIRECT'
  if (['DPR', 'DEPLACE'].some(t => missionType.includes(t)))    interventionType = 'DPR'
  if (['REL', 'RELIVR'].some(t => missionType.includes(t)))     interventionType = 'REL'

  // ── Chauffeur si assigné ──────────────────────────────────────────────────
  let chauffeurName = ''
  if (mission.assigned_to) {
    const { data: driver } = await sb
      .from('users').select('name').eq('id', mission.assigned_to).maybeSingle()
    chauffeurName = driver?.name || ''
  }

  // ── Contact Odoo (best effort) ────────────────────────────────────────────
  let partnerId: number | undefined
  try {
    partnerId = await findOrCreateFsmPartner({
      name:  mission.client_name,
      phone: mission.client_phone,
    })
  } catch (e: any) {
    console.warn(`[FSM] Partner non créé pour mission ${missionId}: ${e.message}`)
  }

  // ── Helpdesk ticket (dossier chapeau) ─────────────────────────────────────
  const { ticketId, ticketUrl } = await createHelpdeskTicket({
    supabaseId:    mission.id,
    dossierNumber: mission.dossier_number || '',
    source:        mission.source || 'PRIVÉ',
    clientName:    mission.client_name  || 'Client inconnu',
    partnerId,
    description:   mission.incident_description || '',
    teamId:        HELPDESK_TEAM_ID,
    vehiclePlate:  mission.vehicle_plate || '',
    city:          mission.incident_city || '',
  })

  // ── Véhicule Parc Auto Odoo ──────────────────────────────────────────────
  let vehicleId: number | undefined
  if (mission.vehicle_plate) {
    try {
      const vId = await findOrCreateFsmVehicle({
        licensePlate: mission.vehicle_plate,
        brandName:    mission.vehicle_brand || '',
        modelName:    mission.vehicle_model || '',
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
    destinationAddress:  mission.destination_address || '',
    description:         mission.incident_description || '',
  })

  const taskId  = fsmResult?.taskId  || null
  const taskUrl = fsmResult?.taskUrl || ''

  // ── Sauvegarde des IDs Odoo ──────────────────────────────────────────────
  const update: any = {
    odoo_helpdesk_id: ticketId,
    odoo_ticket_url:  ticketUrl,
  }
  if (taskId)  update.odoo_task_id  = taskId
  if (taskUrl) update.odoo_task_url = taskUrl
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
