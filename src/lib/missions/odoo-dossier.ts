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

  // ── Partner Odoo : compagnie d'assistance (= client à FACTURER) ──────────
  // Pour les sources connues (touring, ethias, etc.) → mapping direct vers le partner Odoo.
  // Pour les sources sans mapping (privé, garage, etc.) → fallback création depuis client_name.
  const sourceLower = (mission.source || '').toLowerCase()
  let partnerId: number | undefined = ASSISTANCE_PARTNER_BY_SOURCE[sourceLower]
  if (!partnerId) {
    try {
      partnerId = await findOrCreateFsmPartner({
        name:  mission.client_name,
        phone: mission.client_phone,
      })
    } catch (e: any) {
      console.warn(`[FSM] Partner non créé pour mission ${missionId}: ${e.message}`)
    }
  } else {
    console.log(`[FSM] Partner facturation = compagnie ${sourceLower.toUpperCase()} (#${partnerId})`)
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
    beneficiaryName:     mission.client_name  || '',
    beneficiaryPhone:    mission.client_phone || '',
    namePrefix:          testPrefix,
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
