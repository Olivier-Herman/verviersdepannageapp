// src/lib/towsoft-migration/enrich-from-source.ts
//
// Olivier 2026-06-06 : helper pour enrichir une mission VD Soft existante
// depuis une fiche towsoft_migration_source (les 733 enrichies). Appele
// par TOUS les chemins du scan migration qui aboutissent a une mission
// existante (par plaque/VIN, par UUID, par towsoft_num).
//
// Comportement :
// 1. Cherche une fiche towsoft_migration_source par plaque/VIN
// 2. Si trouvee + detail_payload non null : enrichit la mission VD Soft
//    EXISTANTE en COALESCE (ne remplit que les champs vides)
// 3. Lie vdsoft_mission_id sur la fiche source + flag_scanned=true
//
// Retourne le towsoft_num si match (utile pour la reponse API + le log).

import type { SupabaseClient } from '@supabase/supabase-js'

export interface EnrichResult {
  matched:     boolean
  towsoft_num: string | null
  enriched_fields: string[]   // liste des champs effectivement remplis
}

export async function enrichMissionFromTowsoftSource(
  sb: SupabaseClient,
  missionId: string,
  scannedZone: string,
  opts: {
    plate?: string | null
    vin?:   string | null
    /** Si fourni, recherche directement par towsoft_num (cas QR TowSoft). */
    towsoftNum?: string | null
  },
): Promise<EnrichResult> {
  const result: EnrichResult = { matched: false, towsoft_num: null, enriched_fields: [] }

  // 1. Recherche dans towsoft_migration_source (priorite : towsoft_num > VIN > plaque)
  let source: any = null
  if (opts.towsoftNum) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, client_name, date_entree, detail_payload, flag_scanned, vdsoft_mission_id')
      .eq('towsoft_num', opts.towsoftNum)
      .maybeSingle()
    if (data) source = data
  }
  if (!source && opts.vin) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, client_name, date_entree, detail_payload, flag_scanned, vdsoft_mission_id')
      .eq('vin', opts.vin)
      .limit(2)
    if (data && data.length === 1) source = data[0]
  }
  if (!source && opts.plate) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, client_name, date_entree, detail_payload, flag_scanned, vdsoft_mission_id')
      .eq('plate', opts.plate)
      .limit(2)
    if (data && data.length === 1) source = data[0]
  }

  if (!source) return result

  result.matched = true
  result.towsoft_num = source.towsoft_num

  // 2. Charge la mission existante pour COALESCE (on ne remplit que les vides)
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, client_name, incident_address, incident_city, incident_lat, incident_lng, destination_address, destination_lat, destination_lng, officer_name, police_pv_number, remarks_general, parked_at, towsoft_enriched_at')
    .eq('id', missionId)
    .single()

  if (!mission) return result

  const detail = source.detail_payload || {}
  const enrichPayload: Record<string, any> = {
    migration_scanned_at:   new Date().toISOString(),
    migration_scanned_zone: scannedZone,
    towsoft_enriched_at:    new Date().toISOString(),
    updated_at:             new Date().toISOString(),
  }

  // COALESCE field par field : ne remplit que si la valeur courante est vide
  const tryFill = (field: string, candidate: any) => {
    if (candidate == null || candidate === '') return
    if ((mission as any)[field] != null && (mission as any)[field] !== '') return
    enrichPayload[field] = candidate
    result.enriched_fields.push(field)
  }

  tryFill('vehicle_plate',     source.plate || detail.immatriculation)
  tryFill('vehicle_vin',       source.vin || detail.vin)
  tryFill('vehicle_brand',     source.brand || detail.marque)
  tryFill('vehicle_model',     source.model || detail.modele)
  tryFill('client_name',       detail.client_name || source.client_name)
  tryFill('incident_address',  detail.origine_addr)
  tryFill('incident_city',     detail.origine_ville)
  tryFill('incident_lat',      detail.origine_lat ? parseFloat(detail.origine_lat) : null)
  tryFill('incident_lng',      detail.origine_lng ? parseFloat(detail.origine_lng) : null)
  tryFill('destination_address', detail.dest_addr)
  tryFill('destination_lat',     detail.dest_lat ? parseFloat(detail.dest_lat) : null)
  tryFill('destination_lng',     detail.dest_lng ? parseFloat(detail.dest_lng) : null)
  tryFill('officer_name',      detail.nom_responsable)
  tryFill('police_pv_number',  detail.numero_pv)
  tryFill('remarks_general',   detail.remarque)
  tryFill('parked_at',         source.date_entree)

  // 3. UPDATE mission (toujours, au moins pour migration_scanned_at)
  await sb.from('incoming_missions').update(enrichPayload).eq('id', missionId)

  // 4. Lie source -> mission + flag scanned (si pas deja)
  await sb.from('towsoft_migration_source').update({
    vdsoft_mission_id: missionId,
    imported_at:       source.imported_at || new Date().toISOString(),
    flag_scanned:      true,
    scanned_zone:      source.scanned_zone || scannedZone,
    scanned_at:        source.scanned_at || new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  }).eq('id', source.id)

  return result
}

/**
 * Helper plus simple : juste marque migration_scanned_at sur une mission
 * (utilise quand pas de match towsoft_migration_source mais on veut quand
 * meme tracer que la mission a ete scannee dans la session de migration).
 */
export async function markMigrationScanned(
  sb: SupabaseClient,
  missionId: string,
  scannedZone: string,
): Promise<void> {
  await sb.from('incoming_missions').update({
    migration_scanned_at:   new Date().toISOString(),
    migration_scanned_zone: scannedZone,
    updated_at:             new Date().toISOString(),
  }).eq('id', missionId)
}
