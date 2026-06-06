// src/lib/towsoft-migration-worker.ts
//
// Olivier 2026-06-04 : worker qui cree une mission VD Soft depuis une fiche
// towsoft_migration_source scannee. Appele par le cron Phase 4.
//
// Workflow par fiche :
//   1. Validation : detail_payload doit etre present (sinon defere au cron)
//   2. Mapping : motif TowSoft -> source VD Soft + mission_type
//   3. Resolution Odoo :
//      a. helpdesk.ticket existant via x_studio_mission_towsoft = towsoft_num
//      b. fleet.vehicle existant via plate / VIN
//      c. Si ticket trouve : reutiliser odoo_ticket_id
//      d. Sinon : on cree pas le ticket maintenant (peut-etre Phase 5
//         optionnelle), on laisse odoo_ticket_id null
//   4. INSERT incoming_missions avec :
//      - external_id = `TS-${towsoft_num}` (cle d idempotence VD Soft)
//      - source / mission_type / parc_zone_key (= SCANNED_ZONE pas TowSoft)
//      - tous les champs enrichis (client, lieu GPS, police, casier, cles digibox)
//      - parked_at = date_entree TowSoft (pour calcul gardiennage VD Soft)
//      - intervention_date = date_entree TowSoft
//   5. UPDATE towsoft_migration_source.vdsoft_mission_id + imported_at
//   6. Idempotence : si external_id = TS-XXX existe deja en BDD, on update
//      juste parc_zone_key (zone physique a peut-etre change apres re-scan)
//
// Erreurs : import_attempts++, next_import_retry_at backoff exponentiel
// (2min -> 4min -> 8min -> max 30min), abandon apres 10 tentatives.

import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'
import { plateOrVinTail }    from '@/lib/plate'

export interface MigrationWorkerResult {
  ok:          boolean
  action:      'created' | 'updated' | 'skipped' | 'error'
  mission_id?: string
  reason?:     string
}

/**
 * Map motif TowSoft -> source VD Soft + mission_type + zone fallback.
 * La zone reelle utilisee est TOUJOURS scanned_zone (zone physique).
 */
function inferSourceAndType(motif: string | null): { source: string; mission_type: string } {
  if (!motif) return { source: 'legacy_towsoft_migration', mission_type: 'remorquage' }
  const m = motif.toLowerCase().trim()
  if (m.includes('mal') && m.includes('gar'))      return { source: 'police_mg',       mission_type: 'remorquage' }
  if (m.includes('accident'))                       return { source: 'police_accident', mission_type: 'remorquage' }
  if (m.includes('saisie'))                         return { source: 'police_saisie',   mission_type: 'remorquage' }
  if (m.includes('rodeo') || m.includes('rodéo'))   return { source: 'police_rodeo',    mission_type: 'remorquage' }
  if (m.includes('avp') || m.includes('abandon'))   return { source: 'police_avp',      mission_type: 'remorquage' }
  if (m.includes('siabis non couvert'))             return { source: 'police_snc',      mission_type: 'remorquage' }
  if (m.includes('siabis couvert'))                 return { source: 'sia_couvert',     mission_type: 'remorquage' }
  if (m.includes('privé') || m.includes('prive'))   return { source: 'prive',           mission_type: 'remorquage' }
  if (m.includes('défaut'))                          return { source: 'legacy_towsoft_migration', mission_type: 'remorquage' }
  return { source: 'legacy_towsoft_migration', mission_type: 'remorquage' }
}

/**
 * Cherche un ticket helpdesk Odoo existant pour ce numero TowSoft.
 * Retourne null si non trouve. Best-effort : ne fait pas planter si Odoo KO.
 */
async function findExistingOdooTicket(towsoftNum: string): Promise<{ ticketId: number; vehicleId: number | null } | null> {
  try {
    const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
      [['x_studio_mission_towsoft', '=', towsoftNum]],
    ], {
      fields: ['id', 'x_studio_fiche_vehicule'],
      limit:  1,
    })
    if (!tickets || tickets.length === 0) return null
    const t = tickets[0]
    const vehicleId = Array.isArray(t.x_studio_fiche_vehicule)
      ? (typeof t.x_studio_fiche_vehicule[0] === 'number' ? t.x_studio_fiche_vehicule[0] : null)
      : (typeof t.x_studio_fiche_vehicule === 'number' ? t.x_studio_fiche_vehicule : null)
    return { ticketId: t.id, vehicleId }
  } catch (e: any) {
    console.warn(`[migration-worker] Odoo lookup ticket ${towsoftNum} KO:`, e?.message)
    return null
  }
}

/**
 * Cherche un fleet.vehicle Odoo par plaque ou VIN.
 * Retourne l ID Odoo si trouve, null sinon.
 */
async function findExistingOdooVehicle(plate: string | null, vin: string | null): Promise<number | null> {
  try {
    if (vin) {
      const r = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
        [['vin_sn', '=', vin.toUpperCase()]],
      ], { fields: ['id'], limit: 1 })
      if (r && r.length > 0) return r[0].id
    }
    if (plate) {
      const r = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
        [['license_plate', '=', plate.toUpperCase()]],
      ], { fields: ['id'], limit: 1 })
      if (r && r.length > 0) return r[0].id
    }
    return null
  } catch (e: any) {
    console.warn('[migration-worker] Odoo lookup vehicle KO:', e?.message)
    return null
  }
}

/**
 * Traite UNE fiche scannee : cree/update la mission VD Soft.
 * Idempotent : re-execution sur la meme fiche = OK (update zone si changee).
 */
export async function processMigrationFiche(sourceRowId: string): Promise<MigrationWorkerResult> {
  const sb = createAdminClient()

  // 1. Charge la fiche source
  const { data: src, error: srcErr } = await sb
    .from('towsoft_migration_source')
    .select('*')
    .eq('id', sourceRowId)
    .single()

  if (srcErr || !src) {
    return { ok: false, action: 'error', reason: `Source introuvable : ${srcErr?.message || 'unknown'}` }
  }

  if (!src.flag_scanned) {
    return { ok: false, action: 'skipped', reason: 'Pas encore scanne' }
  }

  if (!src.scanned_zone) {
    return { ok: false, action: 'error', reason: 'scanned_zone manquant (anormal)' }
  }

  // 2. Mapping motif -> source/type
  const { source, mission_type } = inferSourceAndType(src.motif)

  // 3. Idempotence : mission VD Soft deja existante via external_id TS-XXX ?
  const externalId = `TS-${src.towsoft_num}`
  const { data: existingMission } = await sb
    .from('incoming_missions')
    .select('id, parc_zone_key, status, odoo_helpdesk_id, odoo_vehicle_id')
    .eq('external_id', externalId)
    .maybeSingle()

  if (existingMission) {
    // Mission deja creee -> update juste parc_zone_key si changee (re-scan zone differente)
    if (existingMission.parc_zone_key !== src.scanned_zone) {
      const { error: upErr } = await sb
        .from('incoming_missions')
        .update({
          parc_zone_key:   src.scanned_zone,
          parc_row_number: null,  // mode bordel migration : pas de slot precis
          parc_slot_index: null,
          updated_at:      new Date().toISOString(),
        })
        .eq('id', existingMission.id)
      if (upErr) return { ok: false, action: 'error', reason: `Update zone KO : ${upErr.message}` }
    }
    // Lie la source -> mission (au cas ou pas encore lie)
    await sb
      .from('towsoft_migration_source')
      .update({
        vdsoft_mission_id: existingMission.id,
        imported_at:       new Date().toISOString(),
        import_error:      null,
        updated_at:        new Date().toISOString(),
      })
      .eq('id', src.id)
    return { ok: true, action: 'updated', mission_id: existingMission.id }
  }

  // 4. Resolve Odoo (best-effort, on continue si KO)
  const detail = src.detail_payload || {}
  const plate = src.plate || detail.immatriculation || null
  const vin   = src.vin   || detail.vin || null

  // 4bis. Olivier 2026-06-06 : DEDUPE PAR PLAQUE/VIN avant l INSERT.
  // L idempotence par external_id=TS-XXX ne couvre PAS le cas ou une
  // mission VD Soft existe deja pour le meme vehicule via un autre flow
  // (Touring, dispatch manuel, Mondial, ...) avec un external_id different.
  // Sans cette verif, on creerait 2 missions VD Soft pour le meme vehicule.
  //
  // Strategie : si une mission ACTIVE (parked/in_progress/delivering/...) existe
  // pour cette plaque ou VIN, on l ENRICHIT avec les donnees TowSoft (sans
  // ecraser ce qui est deja rempli) + on lie la source -> mission. On ne touche
  // PAS son external_id ni son source d origine.
  // Les statuts terminaux (completed/cancelled/to_invoice) sont ignores
  // car ce sont des passages anciens du meme vehicule, pas l intervention actuelle.
  if (plate || vin) {
    const ACTIVE_STATUSES = ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering', 'parked']
    let existingByPlateVin: any = null

    if (vin) {
      const { data } = await sb
        .from('incoming_missions')
        .select('id, external_id, parc_zone_key, status, source, vehicle_plate, vehicle_vin, client_name, incident_address, vehicle_brand, vehicle_model')
        .eq('vehicle_vin', vin)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) existingByPlateVin = data
    }
    if (!existingByPlateVin && plate) {
      const { data } = await sb
        .from('incoming_missions')
        .select('id, external_id, parc_zone_key, status, source, vehicle_plate, vehicle_vin, client_name, incident_address, vehicle_brand, vehicle_model')
        .eq('vehicle_plate', plate)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) existingByPlateVin = data
    }

    if (existingByPlateVin) {
      // Enrichissement defensif : on ne remplit QUE les champs vides
      // (coalesce). Garde l external_id et la source d origine.
      const enrichPayload: Record<string, any> = {
        parc_zone_key:    src.scanned_zone,
        parc_row_number:  null,
        parc_slot_index:  null,
        status:           'parked',
        updated_at:       new Date().toISOString(),
        towsoft_enriched_at: new Date().toISOString(),
      }
      if (!existingByPlateVin.vehicle_plate && plate)               enrichPayload.vehicle_plate    = plate
      if (!existingByPlateVin.vehicle_vin   && vin)                 enrichPayload.vehicle_vin      = vin
      if (!existingByPlateVin.vehicle_brand && (src.brand || detail.marque)) enrichPayload.vehicle_brand = src.brand || detail.marque
      if (!existingByPlateVin.vehicle_model && (src.model || detail.modele)) enrichPayload.vehicle_model = src.model || detail.modele
      if (!existingByPlateVin.client_name   && (detail.client_name || src.client_name)) enrichPayload.client_name = detail.client_name || src.client_name
      if (!existingByPlateVin.incident_address && detail.origine_addr) enrichPayload.incident_address = detail.origine_addr

      const { error: upErr } = await sb
        .from('incoming_missions')
        .update(enrichPayload)
        .eq('id', existingByPlateVin.id)
      if (upErr) {
        return { ok: false, action: 'error', reason: `Enrichissement mission existante KO : ${upErr.message}` }
      }

      // Lie la source -> mission existante (PAS la nouvelle qu on n a pas creee)
      await sb
        .from('towsoft_migration_source')
        .update({
          vdsoft_mission_id: existingByPlateVin.id,
          imported_at:       new Date().toISOString(),
          import_error:      null,
          updated_at:        new Date().toISOString(),
        })
        .eq('id', src.id)

      console.log(`[migration-worker] DEDUPE plaque/VIN : enrichi mission ${existingByPlateVin.id} (external_id=${existingByPlateVin.external_id}) au lieu de creer ${externalId}`)
      return { ok: true, action: 'updated', mission_id: existingByPlateVin.id, reason: 'enriched_existing_by_plate_vin' }
    }
  }

  const odooTicket = await findExistingOdooTicket(src.towsoft_num)
  let odooVehicleId: number | null = odooTicket?.vehicleId || null
  if (!odooVehicleId) {
    odooVehicleId = await findExistingOdooVehicle(plate, vin)
  }

  // 5. INSERT incoming_missions
  const finalPlate = plateOrVinTail(plate, vin) || null

  const insertPayload: Record<string, any> = {
    external_id:       externalId,
    source,
    mission_type,
    status:            'parked',
    parc_zone_key:     src.scanned_zone,   // ⚠️ ZONE PHYSIQUE gagne sur TowSoft
    parc_row_number:   null,                // mode bordel migration
    parc_slot_index:   null,

    vehicle_plate:     finalPlate,
    vehicle_brand:     src.brand || detail.marque || null,
    vehicle_model:     src.model || detail.modele || null,
    vehicle_vin:       vin || null,

    client_name:       detail.client_name || src.client_name || null,
    incident_address:  detail.origine_addr || null,
    incident_city:     detail.origine_ville || null,
    incident_lat:      detail.origine_lat ? parseFloat(detail.origine_lat) : null,
    incident_lng:      detail.origine_lng ? parseFloat(detail.origine_lng) : null,

    destination_address: detail.dest_addr || null,
    destination_lat:    detail.dest_lat ? parseFloat(detail.dest_lat) : null,
    destination_lng:    detail.dest_lng ? parseFloat(detail.dest_lng) : null,

    police_zone:       null,                // pas dans detail TowSoft directement
    officer_name:      detail.nom_responsable || null,
    police_pv_number:  detail.numero_pv || null,

    keys_digibox_slot: detail.cle_box || null,

    received_at:       src.date_entree || new Date().toISOString(),
    intervention_date: src.date_entree || new Date().toISOString(),
    parked_at:         src.date_entree || new Date().toISOString(),

    odoo_helpdesk_id:  odooTicket?.ticketId || null,
    odoo_vehicle_id:   odooVehicleId,

    towsoft_enriched_at: new Date().toISOString(),  // deja enrichi via TowSoft

    remarks_general:   detail.remarque || null,

    created_at:        new Date().toISOString(),
    updated_at:        new Date().toISOString(),
  }

  const { data: created, error: insErr } = await sb
    .from('incoming_missions')
    .insert(insertPayload)
    .select('id, mission_number')
    .single()

  if (insErr) {
    return { ok: false, action: 'error', reason: `INSERT KO : ${insErr.message}` }
  }

  // 6. Lie la source -> mission. Olivier 2026-06-06 : retry avec backoff
  // pour minimiser le risque de mission orpheline (INSERT OK + UPDATE KO).
  // Si toutes les tentatives echouent, on log + on retourne une erreur
  // CLAIRE (mission_id retournee + reason) pour que l opérateur sache que
  // le lien est manquant et que la dedupe plaque/VIN du prochain scan
  // rattrapera la situation.
  let linkErr: any = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 200 * attempt))
    const { error } = await sb
      .from('towsoft_migration_source')
      .update({
        vdsoft_mission_id: created.id,
        imported_at:       new Date().toISOString(),
        import_error:      null,
        updated_at:        new Date().toISOString(),
      })
      .eq('id', src.id)
    if (!error) { linkErr = null; break }
    linkErr = error
    console.warn(`[migration-worker] Lien source-mission tentative ${attempt + 1}/3 KO ${src.towsoft_num}:`, error.message)
  }

  if (linkErr) {
    console.error(`[migration-worker] ALERTE : mission ${created.id} (towsoft_num=${src.towsoft_num}) creee MAIS source non liee apres 3 tentatives. La dedupe plaque/VIN du prochain scan rattrapera, ne pas re-scanner manuellement.`)
    return {
      ok: true,
      action: 'created',
      mission_id: created.id,
      reason: `Mission creee, lien source KO apres 3 tentatives : ${linkErr.message}. Dedupe plaque/VIN au prochain scan.`,
    }
  }

  return { ok: true, action: 'created', mission_id: created.id }
}
