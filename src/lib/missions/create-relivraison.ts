// src/lib/missions/create-relivraison.ts
//
// Crée automatiquement une mission de relivraison (REL) quand un chauffeur
// met un véhicule en parc au lieu de le livrer à destination.
//
// La nouvelle mission a :
//   - status: 'dispatching' (= confirmée, en attente d'assignation chauffeur)
//   - parent_mission_id: la mission de remorquage initiale
//   - incident_address: adresse du parc (où est le véhicule)
//   - destination_address: adresse originale de la mission parent
//   - infos client/véhicule/source: héritées du parent
//   - external_id: 'REL-{parent_external_id}'
//   - mission_type: 'remorquage'
//
// Crée aussi automatiquement le dossier Odoo (helpdesk + FSM task) pour la REL.

import { createAdminClient }            from '@/lib/supabase'
import { createOdooDossierForMission }  from '@/lib/missions/odoo-dossier'
import { sendPushToUser }               from '@/lib/push'
import { rpcFsm, getFsmStageId }        from '@/lib/odoo-fsm'

export interface RelivraisonInput {
  parentMissionId:  string
  parkAddress:      string
  parkLat?:         number | null
  parkLng?:         number | null
  /** Adresse originale = destination à atteindre lors de la REL future */
  redeliveryAddress: string
}

export async function createRelivraisonMission(input: RelivraisonInput): Promise<{ id: string } | null> {
  const sb = createAdminClient()

  // Lecture mission parente pour hériter des infos
  const { data: parent, error: pErr } = await sb
    .from('incoming_missions')
    .select('*')
    .eq('id', input.parentMissionId)
    .single()
  if (pErr || !parent) {
    console.error('[REL] Mission parent introuvable:', pErr?.message)
    return null
  }

  const externalId = `REL-${parent.external_id || parent.id.slice(0, 8)}`

  // Vérifier qu'on n'a pas déjà créé une REL pour ce parent (idempotence)
  const { data: existing } = await sb
    .from('incoming_missions')
    .select('id')
    .eq('parent_mission_id', input.parentMissionId)
    .eq('external_id', externalId)
    .maybeSingle()
  if (existing) {
    console.log(`[REL] Mission REL deja existante pour parent ${input.parentMissionId}: ${existing.id}`)
    return { id: existing.id }
  }

  // Insertion de la nouvelle mission REL
  const relTs = new Date().toISOString()
  const { data: rel, error: insErr } = await sb
    .from('incoming_missions')
    .insert({
      external_id:           externalId,
      dossier_number:        parent.dossier_number ? `${parent.dossier_number}-REL` : null,
      source:                parent.source,
      source_format:         'auto_rel',
      mission_type:          'remorquage',
      incident_type:         'relivraison',
      incident_description:  `Relivraison après mise en parc — Mission parent : ${parent.external_id || parent.id.slice(0, 8)}`,
      // Client + véhicule hérités
      client_name:           parent.client_name,
      client_phone:          parent.client_phone,
      client_email:          parent.client_email,
      client_address:        parent.client_address,
      vehicle_plate:         parent.vehicle_plate,
      vehicle_brand:         parent.vehicle_brand,
      vehicle_model:         parent.vehicle_model,
      vehicle_vin:           parent.vehicle_vin,
      vehicle_fuel:          parent.vehicle_fuel,
      vehicle_gearbox:       parent.vehicle_gearbox,
      // Lieu d'incident = parc (lieu actuel du véhicule)
      incident_address:      input.parkAddress,
      incident_lat:          input.parkLat   ?? null,
      incident_lng:          input.parkLng   ?? null,
      // Destination = adresse originale (où il devait aller)
      destination_address:   input.redeliveryAddress,
      destination_name:      parent.destination_name,
      // Infos facturation héritées
      billed_to_name:        parent.billed_to_name,
      billed_to_id:          parent.billed_to_id,
      assisted_name:         parent.assisted_name,
      assisted_phone:        parent.assisted_phone,
      // Statuts
      status:                'dispatching',     // confirmée mais à assigner par le dispatcher
      dispatch_mode:         'manual',
      received_at:           relTs,
      intervention_date:     relTs,
      // Lien vers parent
      parent_mission_id:     input.parentMissionId,
      // Confiance maximale (info dérivée fiable, pas de parsing)
      parse_confidence:      1.0,
      odoo_vehicle_id:       parent.odoo_vehicle_id,
      depot_depart_id:       parent.depot_depart_id,
    })
    .select('id')
    .single()

  if (insErr || !rel) {
    console.error('[REL] Insert mission échoué:', insErr?.message)
    return null
  }

  console.log(`[REL] Mission REL créée: ${rel.id} (parent: ${input.parentMissionId})`)

  // La mission parente passe en 'to_invoice' : sa partie 'remorquage vers parc'
  // est terminee, prete a etre facturee separement (chaque fiche est facturable
  // independamment). Le reste de la chaine (relivraison) est portee par la
  // nouvelle REL qui suivra son propre cycle vers 'to_invoice' a sa cloture.
  await sb
    .from('incoming_missions')
    .update({ status: 'to_invoice', completed_at: new Date().toISOString() })
    .eq('id', input.parentMissionId)
  await sb.from('mission_logs').insert({
    mission_id: input.parentMissionId,
    action:     'completed',
    notes:      `Terminée — relivraison déléguée à la mission ${externalId}, à facturer`,
    metadata:   { rel_mission_id: rel.id },
  })

  // Stage FSM Odoo de la mission parente → "A facturer"
  // (le remorquage vers parc est fini, prêt à être facturé séparément ;
  //  la suite du flow est sur la nouvelle mission REL)
  if (parent.odoo_task_id) {
    try {
      const stageId = await getFsmStageId('A facturer')
      if (stageId) {
        await rpcFsm('project.task', 'write', [[parent.odoo_task_id], { stage_id: stageId }])
      }
    } catch (e: any) {
      console.error('[REL] Update stage FSM parent échoué:', e.message)
    }
  }

  // Créer le dossier Odoo pour la REL en arrière-plan
  createOdooDossierForMission(rel.id).catch(e => {
    console.error('[REL] Création dossier Odoo échouée:', e.message)
  })

  // Notifier les dispatchers actifs (push) — best effort
  try {
    const { data: dispatchers } = await sb
      .from('users')
      .select('id')
      .eq('active', true)
      .or('role.eq.dispatcher,role.eq.admin,role.eq.superadmin')
    for (const dispatcher of (dispatchers || [])) {
      sendPushToUser(dispatcher.id, {
        title: '🅿️ Mission REL à assigner',
        body:  `${parent.client_name || 'Véhicule'} ${parent.vehicle_plate || ''} → ${input.redeliveryAddress}`,
        url:   `/dispatch/${rel.id}`,
        tag:   `mission-rel-${rel.id}`,
      }).catch(() => {})
    }
  } catch {}

  return { id: rel.id }
}
