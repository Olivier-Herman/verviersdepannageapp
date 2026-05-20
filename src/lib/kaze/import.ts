// src/lib/kaze/import.ts
//
// Logique d import d un Job Kaze vers incoming_missions.
//
// Flow :
//   1. Fetch detail du Job Kaze (GET /api/jobs/<id>.json)
//   2. Map workflow -> structure normalisee (cf mapper.ts)
//   3. Lookup partner Odoo (par TVA + nom) pour remplir billed_to_*
//   4. Dedup : par kaze_job_id ou dossier_number
//   5. INSERT ou UPDATE dans incoming_missions
//   6. Marquer le webhook event comme traite (si call depuis webhook)

import { createAdminClient }     from '@/lib/supabase'
import { getJob }                 from '@/lib/kaze/client'
import { mapKazeJobToMission }    from '@/lib/kaze/mapper'
import { lookupPartner }          from '@/lib/odoo-quote'

export interface KazeImportResult {
  ok:           boolean
  mission_id:   string | null
  kaze_job_id:  string
  action:       'insert' | 'update_by_kaze_id' | 'update_by_dossier' | 'skipped_error'
  billed_to:    { id: number; name: string } | null
  warnings:     string[]
  error?:       string
}

/**
 * Importe une mission Kaze dans incoming_missions.
 *
 * @param kazeJobId UUID du job cote Kaze
 * @param opts.webhookEventId si appele depuis le webhook, lie le row d audit
 *                            apres traitement (processed_at + mission_id)
 */
export async function importKazeJob(
  kazeJobId: string,
  opts: { webhookEventId?: string } = {},
): Promise<KazeImportResult> {
  const warnings: string[] = []
  const result: KazeImportResult = {
    ok:          false,
    mission_id:  null,
    kaze_job_id: kazeJobId,
    action:      'skipped_error',
    billed_to:   null,
    warnings,
  }

  let job: any
  try {
    job = await getJob(kazeJobId)
  } catch (e: any) {
    result.error = `Fetch job Kaze échoué : ${e.message}`
    await markEventProcessed(opts.webhookEventId, null, result.error)
    return result
  }

  // Validation : c est bien notre company
  const expectedCompany = 'f3d17688-7b5a-458b-be5e-e6732e67c02c'
  if (job.target_id && job.target_id !== expectedCompany) {
    warnings.push(`target_id ${job.target_id} ≠ Verviers Dépannage SA`)
  }

  // Mapping workflow → structure normalisee
  const mapped = mapKazeJobToMission(job)

  // Lookup partner Odoo (entite a facturer)
  let billedToId:   number | null = null
  let billedToName: string | null = mapped.billing_entity_name

  if (mapped.billing_entity_name || mapped.billing_vat) {
    try {
      const partner = await lookupPartner({
        vat:  mapped.billing_vat,
        name: mapped.billing_entity_name,
      })
      if (partner) {
        billedToId   = partner.id
        billedToName = partner.name  // Utilise le nom Odoo officiel
        result.billed_to = partner
      } else {
        warnings.push(
          `Aucun partner Odoo trouve pour entite=${mapped.billing_entity_name} ` +
          `TVA=${mapped.billing_vat} — billed_to laisse a remplir manuellement`,
        )
      }
    } catch (e: any) {
      warnings.push(`Lookup Odoo partner échoué (non bloquant) : ${e.message}`)
    }
  } else {
    warnings.push('Aucune info de facturation dans le payload Kaze')
  }

  // Dedup en BDD : 1) par kaze_job_id   2) par (source, dossier_number)
  const sb = createAdminClient()

  let existingId: string | null = null
  let action: KazeImportResult['action'] = 'insert'

  // 1. Recherche par kaze_job_id (le plus fiable)
  const { data: byKaze } = await sb
    .from('incoming_missions')
    .select('id')
    .eq('kaze_job_id', kazeJobId)
    .maybeSingle()

  if (byKaze?.id) {
    existingId = byKaze.id
    action     = 'update_by_kaze_id'
  } else if (mapped.dossier_number) {
    // 2. Recherche par dossier_number sur sources Ethias/Vivium/pv_assistance/kaze
    //    (la meme mission peut etre arrivee d abord par mail Ethias/Vivium puis
    //    par Kaze — on relie en mettant a jour la ligne mail avec kaze_job_id)
    const { data: byDossier } = await sb
      .from('incoming_missions')
      .select('id, source')
      .eq('dossier_number', mapped.dossier_number)
      .in('source', ['ethias', 'vivium', 'pv_assistance', 'kaze'])
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (byDossier?.id) {
      existingId = byDossier.id
      action     = 'update_by_dossier'
    }
  }

  // Payload commun (insert et update)
  const payload: Record<string, any> = {
    source:               'kaze',
    external_id:          mapped.external_id,
    kaze_job_id:          mapped.kaze_job_id,
    dossier_number:       mapped.dossier_number,
    mission_type:         mapped.mission_type,
    incident_type:        mapped.incident_type,
    incident_description: mapped.incident_description,
    incident_address:     mapped.incident_address,
    incident_city:        mapped.incident_city,
    incident_country:     mapped.incident_country || 'BE',
    destination_name:     mapped.destination_name,
    destination_address:  mapped.destination_address,
    vehicle_plate:        mapped.vehicle_plate,
    vehicle_brand:        mapped.vehicle_brand,
    vehicle_model:        mapped.vehicle_model,
    vehicle_fuel:         mapped.vehicle_fuel,
    client_name:          mapped.client_name,
    client_phone:         mapped.client_phone,
    incident_at:          mapped.intervention_at,
    parsed_data:          mapped,   // arbre complet pour debug + acces fields non-colonnes
    parse_confidence:     1.0,      // pas de doute possible, c est l API source
    source_format:        'json',
  }

  if (billedToId !== null) {
    payload.billed_to_id   = billedToId
    payload.billed_to_name = billedToName
  } else if (billedToName) {
    payload.billed_to_name = billedToName
  }

  try {
    if (existingId) {
      // UPDATE : on n ecrase pas status/dispatch_mode/intervention_date qui
      // peuvent avoir ete modifies par le dispatcher.
      const { error } = await sb
        .from('incoming_missions')
        .update(payload)
        .eq('id', existingId)
      if (error) throw error
      result.mission_id = existingId
      result.action     = action
    } else {
      // INSERT : on init status/intervention_date/dispatch_mode
      const fullPayload = {
        ...payload,
        status:            'new',
        dispatch_mode:     'manual',
        received_at:       new Date().toISOString(),
        intervention_date: mapped.intervention_at || new Date().toISOString(),
      }
      const { data, error } = await sb
        .from('incoming_missions')
        .insert(fullPayload)
        .select('id')
        .single()
      if (error) throw error
      result.mission_id = data!.id
      result.action     = 'insert'
    }

    result.ok = true

    // Log mission
    await sb.from('mission_logs').insert({
      mission_id: result.mission_id,
      action:     result.action === 'insert' ? 'received' : 'updated_from_kaze',
      notes:      `Kaze : ${mapped.dossier_number} — ${mapped.vehicle_plate || '?'} → ${billedToName || 'billed_to manquant'}`,
      metadata:   { kaze_job_id: kazeJobId, action: result.action, warnings },
    }).then(() => {}, e => console.warn('[kaze import] mission_logs insert failed:', e?.message))

    // Audit : marque le webhook event comme traite
    await markEventProcessed(opts.webhookEventId, result.mission_id, null)

  } catch (e: any) {
    result.error = `BDD upsert échoué : ${e.message}`
    await markEventProcessed(opts.webhookEventId, null, result.error)
  }

  return result
}

async function markEventProcessed(
  eventId: string | undefined,
  missionId: string | null,
  errorMsg: string | null,
) {
  if (!eventId) return
  try {
    const sb = createAdminClient()
    await sb.from('kaze_webhook_events').update({
      processed_at:     new Date().toISOString(),
      processing_error: errorMsg,
      mission_id:       missionId,
    }).eq('id', eventId)
  } catch (e: any) {
    console.warn('[kaze import] markEventProcessed failed:', e?.message)
  }
}
