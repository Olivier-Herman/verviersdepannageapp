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
    // 2. Recherche de TOUS les doublons du meme dossier (la meme mission IMA
    //    arrive souvent en plusieurs exemplaires : mail Ethias/Vivium/P&V +
    //    placeholder 'unknown' + webhook Kaze). Olivier 2026-06-18 : on veut
    //    qu'il ne reste QUE la mission Kaze. On garde 1 survivant (de preference
    //    deja Kaze, sinon celui le plus avance par le chauffeur — on ne casse pas
    //    son travail), on le passe en Kaze, et on FUSIONNE les autres (ignored).
    const { data: cands } = await sb
      .from('incoming_missions')
      .select('id, source, status, kaze_job_id, assigned_to, received_at')
      .eq('dossier_number', mapped.dossier_number)
      .in('source', ['ethias', 'vivium', 'pv_assistance', 'kaze', 'unknown'])
      .not('status', 'in', '("cancelled","ignored","completed","to_invoice")')

    if (cands && cands.length) {
      const STATUS_RANK: Record<string, number> = {
        in_progress: 5, delivering: 5, assigned: 4, accepted: 4, parked: 3, dispatching: 2, new: 1,
      }
      const score = (m: any) =>
        (m.kaze_job_id === kazeJobId ? 1000 : 0)
        + (m.assigned_to ? 100 : 0)
        + (STATUS_RANK[m.status] || 0)
      const sorted = [...cands].sort((a, b) => score(b) - score(a))
      existingId = sorted[0].id
      action     = 'update_by_dossier'

      for (const dup of sorted.slice(1)) {
        await sb.from('incoming_missions')
          .update({ status: 'ignored', updated_at: new Date().toISOString() })
          .eq('id', dup.id)
        await sb.from('mission_logs').insert({
          mission_id: dup.id,
          action:     'merged',
          notes:      `Doublon fusionné dans la mission Kaze (dossier ${mapped.dossier_number}) — source d'origine ${dup.source}`,
          metadata:   { merged_into: existingId, kaze_job_id: kazeJobId, from_source: dup.source },
        }).then(() => {}, () => {})
      }
    }
  }

  // Auto-link REM ↔ REL (convention IMA : ref suffixe AA = mission principale,
  // AB = relivraison). On detecte les 2 sens :
  //   - Si on importe la REL et la REM existe deja → on set parent_mission_id
  //   - Si on importe la REM et la REL existe deja → on backfill la REL apres
  //     l upsert pour qu elle pointe vers cette nouvelle REM
  let parent_mission_id: string | null = null
  let relToBackfillId:   string | null = null
  if (mapped.dossier_number) {
    const ref     = mapped.dossier_number
    const baseRef = ref.replace(/A[A-Z]$/, '')
    const isRel   = mapped.incident_type === 'relivraison' || /AB$/.test(ref)

    if (isRel && baseRef !== ref) {
      // On cherche la REM principale (ref se terminant par AA)
      const { data: parent } = await sb
        .from('incoming_missions')
        .select('id')
        .eq('source', 'kaze')
        .ilike('dossier_number', `${baseRef}AA`)
        .maybeSingle()
      if (parent?.id) parent_mission_id = parent.id
    } else if (/AA$/.test(ref)) {
      // On importe la REM principale. Y a-t-il une REL qui pointe ici ?
      const { data: relChild } = await sb
        .from('incoming_missions')
        .select('id, parent_mission_id')
        .eq('source', 'kaze')
        .ilike('dossier_number', `${baseRef}AB`)
        .maybeSingle()
      if (relChild?.id && !relChild.parent_mission_id) {
        relToBackfillId = relChild.id
      }
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

  if (parent_mission_id) {
    payload.parent_mission_id = parent_mission_id
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

    // Backfill : si on vient d inserer/updater la REM principale et qu une REL
    // orpheline existe deja, on la fait pointer vers cette REM
    if (relToBackfillId && result.mission_id) {
      const { error: backfillErr } = await sb
        .from('incoming_missions')
        .update({ parent_mission_id: result.mission_id })
        .eq('id', relToBackfillId)
        .is('parent_mission_id', null)  // safety : ne pas ecraser si deja set
      if (backfillErr) {
        warnings.push(`Backfill REL parent_mission_id échoué : ${backfillErr.message}`)
      } else {
        warnings.push(`REL ${relToBackfillId} liee a cette REM (backfill)`)
      }
    }

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

/**
 * Annule une mission Kaze suite a un event "Tache annulee" / "Mission
 * proposee annulee" / "Proposition expiree" recu via webhook.
 * Cherche par kaze_job_id et passe le status a 'cancelled' (sauf si deja
 * dans un etat terminal).
 */
export async function cancelKazeJob(
  kazeJobId: string,
  opts: { webhookEventId?: string; reason?: string } = {},
): Promise<{ ok: boolean; mission_id: string | null; action: 'cancelled' | 'not_found' | 'skipped' }> {
  const sb = createAdminClient()
  const { data: m } = await sb
    .from('incoming_missions')
    .select('id, status')
    .eq('kaze_job_id', kazeJobId)
    .maybeSingle()

  if (!m?.id) {
    await markEventProcessed(opts.webhookEventId, null, 'Mission Kaze introuvable pour annulation')
    return { ok: false, mission_id: null, action: 'not_found' }
  }

  // Etat terminal : on n annule pas si la mission est deja completed/ignored
  if (['completed', 'cancelled', 'ignored'].includes(m.status)) {
    await markEventProcessed(opts.webhookEventId, m.id, null)
    return { ok: true, mission_id: m.id, action: 'skipped' }
  }

  const { error } = await sb
    .from('incoming_missions')
    .update({ status: 'cancelled' })
    .eq('id', m.id)

  if (error) {
    await markEventProcessed(opts.webhookEventId, m.id, error.message)
    return { ok: false, mission_id: m.id, action: 'not_found' }
  }

  await sb.from('mission_logs').insert({
    mission_id: m.id,
    action:     'cancelled_by_kaze',
    notes:      opts.reason || 'Annulation reçue via webhook Kaze',
    metadata:   { kaze_job_id: kazeJobId },
  }).then(() => {}, () => {})

  await markEventProcessed(opts.webhookEventId, m.id, null)
  return { ok: true, mission_id: m.id, action: 'cancelled' }
}
