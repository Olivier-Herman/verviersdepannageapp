// src/app/api/admin/towsoft-migration/scan/route.ts
//
// POST /api/admin/towsoft-migration/scan
// Body: { raw_input: string, zone: string, force_rescan?: boolean }
//
// Traite un scan terrain :
//   - Parse l input (QR /qr/mission, /v/, towsoft num direct, ou plaque/VIN)
//   - Match dans towsoft_migration_source
//   - Marque flag_scanned + scanned_zone + scanned_at
//   - Retourne le statut (deja scanne ailleurs / nouveau / fantome inverse)
//
// Le worker Phase 4 (cron) prendra le relais pour creer la mission VD Soft.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { parseScanInput }   from '@/lib/towsoft-migration/parse-scan'
import { odooRpc, withOdooActor } from '@/lib/odoo'
import { FOURRIERE_ZONES }  from '@/lib/fourriere'
import { processMigrationFiche } from '@/lib/towsoft-migration-worker'
import { reprintLabelForMission } from '@/lib/missions/reprint-label-helper'
import { enrichMissionFromTowsoftSource, markMigrationScanned } from '@/lib/towsoft-migration/enrich-from-source'

export const dynamic = 'force-dynamic'

interface ScanBody {
  raw_input:      string
  zone:           string
  force_rescan?:  boolean
  /** Olivier 2026-06-06 : si true, imprime l etiquette parc juste apres la
   *  creation de la mission VD Soft (workflow migration zone-par-zone). */
  print_label?:   boolean
  /** Olivier 2026-06-06 PM : mode manuel = preview-only. Aucune ecriture en
   *  BDD ni dans Odoo, on retourne juste un descriptif de ce qui SERAIT fait.
   *  L UI affiche le preview, l operateur valide, et l UI re-call sans dry_run.
   */
  dry_run?:       boolean
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as ScanBody
  const raw  = String(body.raw_input || '').trim()
  const zone = String(body.zone || '').trim()
  const forceRescan = Boolean(body.force_rescan)
  const printLabel  = Boolean(body.print_label)
  const dryRun      = Boolean(body.dry_run)

  if (!raw)  return NextResponse.json({ error: 'raw_input requis' }, { status: 400 })
  if (!zone) return NextResponse.json({ error: 'zone requise' }, { status: 400 })

  const sb = createAdminClient()

  // 1. Parse l input pour determiner le format
  const parsed = parseScanInput(raw)

  // Olivier 2026-06-06 PM : mode manuel = preview-only sans ecriture
  if (dryRun) {
    return await previewScan({ sb, raw, zone, parsed, forceRescan, printLabel })
  }

  // 1bis. Olivier 2026-06-04 : si QR VD Soft (qr_mission) ou Verviers-QR (v_legacy),
  // on retrouve la plaque/towsoft_num via incoming_missions pour pouvoir matcher
  // la fiche source. Ces 2 formats correspondent a des etiquettes posees AVANT
  // la migration ou regenerees apres - le vehicule est dans incoming_missions
  // avec sa plaque + external_id TS-{towsoft_num} si origine TowSoft.
  let resolvedTowsoftNum: string | null = parsed.towsoftNum
  let resolvedPlate:      string | null = parsed.plate
  let resolvedVin:        string | null = parsed.vin

  if (!resolvedTowsoftNum && (parsed.missionNum || parsed.ticketId || parsed.odooVehicleId)) {
    let missionQuery = sb
      .from('incoming_missions')
      .select('id, mission_number, external_id, vehicle_plate, vehicle_vin, odoo_helpdesk_id, odoo_vehicle_id')
      .limit(1)

    if (parsed.missionNum) {
      // mission_number peut etre l ID UUID ou le numero court (8 chiffres)
      const isUuid = /^[0-9a-f-]{36}$/i.test(parsed.missionNum)
      const isNum  = /^\d+$/.test(parsed.missionNum)
      if (isUuid) {
        missionQuery = missionQuery.eq('id', parsed.missionNum)
      } else if (isNum) {
        missionQuery = missionQuery.eq('mission_number', parseInt(parsed.missionNum, 10))
      } else {
        missionQuery = missionQuery.eq('id', parsed.missionNum)  // fallback, retournera vide
      }
    } else if (parsed.ticketId) {
      missionQuery = missionQuery.eq('odoo_helpdesk_id', parseInt(parsed.ticketId, 10))
    } else if (parsed.odooVehicleId) {
      missionQuery = missionQuery.eq('odoo_vehicle_id', parseInt(parsed.odooVehicleId, 10))
    }

    const { data: vdsMission } = await missionQuery.maybeSingle()
    if (vdsMission) {
      // external_id format = "TS-{towsoft_num}" si origine TowSoft
      if (vdsMission.external_id && vdsMission.external_id.startsWith('TS-')) {
        resolvedTowsoftNum = vdsMission.external_id.replace(/^TS-/, '')
      }
      if (!resolvedPlate) resolvedPlate = vdsMission.vehicle_plate
      if (!resolvedVin)   resolvedVin   = vdsMission.vehicle_vin
    }
  }

  // 2. Match dans towsoft_migration_source (priorite : towsoft_num > VIN > plaque)
  let match: any = null

  if (resolvedTowsoftNum) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, flag_scanned, scanned_zone, scanned_at, imported_at')
      .eq('towsoft_num', resolvedTowsoftNum)
      .maybeSingle()
    match = data
  }

  if (!match && resolvedVin) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, flag_scanned, scanned_zone, scanned_at, imported_at')
      .eq('vin', resolvedVin)
      .maybeSingle()
    match = data
  }

  // Olivier 2026-06-04 : TowSoft stocke parfois UNIQUEMENT les 5 derniers
  // caracteres du VIN. Si on a un VIN complet (17 chars) sans match exact,
  // on tente une egalite sur les 5 derniers chars.
  if (!match && resolvedVin && resolvedVin.length === 17) {
    const last5 = resolvedVin.slice(-5).toUpperCase()
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, flag_scanned, scanned_zone, scanned_at, imported_at')
      .eq('vin', last5)
      .limit(2)
    if (data && data.length === 1) match = data[0]
    // si data.length > 1, plusieurs vehicules ont le meme suffixe -> ambigu,
    // on laisse match=null pour forcer l operateur a utiliser plaque ou towsoft_num
  }

  if (!match && resolvedPlate) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, flag_scanned, scanned_zone, scanned_at, imported_at')
      .eq('plate', resolvedPlate)
      .maybeSingle()
    match = data
  }

  // Olivier 2026-06-04 : si l input est court (4-8 chars alphanumeriques sans
  // I/O/Q comme un VIN tronque) et qu on n a pas matche par plaque, tenter
  // aussi un match en tant que suffixe VIN. Couvre le cas ou l operateur tape
  // directement les 5 derniers chars qu il lit sur la fiche TowSoft.
  if (!match && resolvedPlate && resolvedPlate.length >= 4 && resolvedPlate.length <= 8
      && /^[A-HJ-NPR-Z0-9]+$/i.test(resolvedPlate)) {
    const candidate = resolvedPlate.toUpperCase()
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, flag_scanned, scanned_zone, scanned_at, imported_at')
      .eq('vin', candidate)
      .limit(2)
    if (data && data.length === 1) match = data[0]
  }

  // Olivier 2026-06-04 : avant de creer un fantome, on cherche une mission
  // VD Soft EXISTANTE par plaque/VIN. Cas typique : vehicule cree en VD Soft
  // post-bascule (pas dans towsoft_migration_source), ou ancien helpdesk Odoo
  // migre. Si trouve, on associe directement la mission a la zone scannee
  // (= replacement direct sans creer fantome).
  if (!match && (resolvedPlate || resolvedVin)) {
    let existingMission: any = null

    if (resolvedVin) {
      const { data } = await sb
        .from('incoming_missions')
        .select('id, mission_number, vehicle_plate, vehicle_vin, status, parc_zone_key, source')
        .eq('vehicle_vin', resolvedVin)
        .in('status', ['parked', 'delivering', 'created', 'assigned', 'in_progress'])
        .limit(2)
      if (data && data.length === 1) existingMission = data[0]
    }
    if (!existingMission && resolvedPlate) {
      const { data } = await sb
        .from('incoming_missions')
        .select('id, mission_number, vehicle_plate, vehicle_vin, status, parc_zone_key, source')
        .eq('vehicle_plate', resolvedPlate)
        .in('status', ['parked', 'delivering', 'created', 'assigned', 'in_progress'])
        .limit(2)
      if (data && data.length === 1) existingMission = data[0]
    }

    if (existingMission) {
      // Met a jour la zone directement sur la mission existante
      const { error: upErr } = await sb
        .from('incoming_missions')
        .update({
          parc_zone_key:   zone,
          parc_row_number: null,
          parc_slot_index: null,
          status:          'parked',
          migration_scanned_at:   new Date().toISOString(),
          migration_scanned_zone: zone,
          updated_at:      new Date().toISOString(),
        })
        .eq('id', existingMission.id)

      if (upErr) {
        return NextResponse.json({ error: `Update mission existante KO : ${upErr.message}` }, { status: 500 })
      }

      // Olivier 2026-06-06 : enrichissement universel depuis towsoft_migration_source
      // Si une fiche TowSoft enrichie existe pour ce vehicule (par plaque/VIN), on la
      // copie dans la mission VD Soft existante en COALESCE (ne touche pas les champs
      // deja remplis). Resultat : mission VD Soft devient riche meme si elle a ete creee
      // via Touring/Mondial/dispatch (et non TowSoft).
      let enrichResult: any = null
      try {
        enrichResult = await enrichMissionFromTowsoftSource(sb, existingMission.id, zone, {
          plate: resolvedPlate || existingMission.vehicle_plate,
          vin:   resolvedVin   || existingMission.vehicle_vin,
        })
      } catch (e: any) {
        console.warn('[scan] enrichFromTowsoft KO:', e?.message)
      }

      // Log audit
      await sb.from('mission_logs').insert({
        mission_id: existingMission.id,
        action:     'parc_scanned_migration',
        notes:      `Scan migration : reassignee en zone ${zone}${existingMission.parc_zone_key && existingMission.parc_zone_key !== zone ? ` (depuis ${existingMission.parc_zone_key})` : ''}${enrichResult?.matched ? ` + enrichi depuis TowSoft #${enrichResult.towsoft_num} (${enrichResult.enriched_fields.length} champs)` : ''}`,
        actor_id:   user.id,
        metadata:   {
          from_zone:  existingMission.parc_zone_key,
          to_zone:    zone,
          raw_input:  raw,
          parsed_format: parsed.format,
          enriched_from_towsoft: enrichResult?.matched || false,
          towsoft_num: enrichResult?.towsoft_num || null,
          enriched_fields: enrichResult?.enriched_fields || [],
        },
      }).then(() => {}, e => console.warn('[scan/migration] log KO:', e?.message))

      // Transfert state Odoo (sync)
      let odooStateResult: any = null
      try {
        odooStateResult = await transferOdooState({
          plate:   existingMission.vehicle_plate,
          vin:     existingMission.vehicle_vin,
          zoneKey: zone,
          userId:  user.id,
        })
      } catch (e: any) {
        odooStateResult = { ok: false, reason: String(e?.message || e).slice(0, 200) }
      }

      // Print etiquette si demande
      let printResult: any = null
      if (Boolean(body.print_label)) {
        try {
          printResult = await reprintLabelForMission({ kind: 'uuid', value: existingMission.id })
        } catch (e: any) {
          printResult = { ok: false, error: String(e?.message || e).slice(0, 200) }
        }
      }

      return NextResponse.json({
        ok: true,
        reason: 'linked_to_existing_vdsoft',
        message: `✓ Mission VD Soft existante liée à zone ${zone} (${existingMission.vehicle_plate || existingMission.vehicle_vin || 'plaque inconnue'})${enrichResult?.matched ? ` + enrichi TowSoft (${enrichResult.enriched_fields.length} champs)` : ''}`,
        match: {
          plate: existingMission.vehicle_plate,
          vin:   existingMission.vehicle_vin,
          mission_id: existingMission.id,
          source: existingMission.source,
          towsoft_num: enrichResult?.towsoft_num || null,
        },
        parsed,
        vdsoft_mission_id: existingMission.id,
        odoo_state_transferred: !!odooStateResult?.ok,
        odoo_state_reason: odooStateResult?.reason || null,
        label_printed: !!printResult?.ok,
        label_error:   printResult?.error || null,
        towsoft_enriched: enrichResult?.matched || false,
        towsoft_enriched_fields: enrichResult?.enriched_fields || [],
      })
    }
  }

  // 3a. Pas de match -> fantome inverse (log dans orphan_scans pour suivi)
  // Olivier 2026-06-04 : DERNIER RECOURS = lookup Odoo fleet.vehicle.
  // Si trouve, on cree une mission VD Soft minimaliste avec les infos Odoo
  // (plate, brand, model, vin) + odoo_vehicle_id + helpdesk_ticket si dispo.
  // Et on transfere le state Odoo vers la zone scannee.
  // Tout ca evite de tomber en fantome pour un vehicule qui existe vraiment.
  if (!match) {
    const odooLookup = await createFromOdooIfFound({
      plate:   resolvedPlate,
      vin:     resolvedVin,
      zone,
      userId:  user.id,
      sb,
    })

    if (odooLookup.ok) {
      // Olivier 2026-06-06 : enrichissement universel + tracking
      let enrichResult: any = null
      if (odooLookup.missionId) {
        try {
          enrichResult = await enrichMissionFromTowsoftSource(sb, odooLookup.missionId, zone, {
            plate: odooLookup.plate,
            vin:   odooLookup.vin,
          })
        } catch (e: any) {
          console.warn('[scan] enrichFromTowsoft KO:', e?.message)
        }
        // markMigrationScanned est appele dans enrichMissionFromTowsoftSource si match,
        // sinon on doit le faire ici
        if (!enrichResult?.matched) {
          await markMigrationScanned(sb, odooLookup.missionId, zone).catch(() => {})
        }
      }
      return NextResponse.json({
        ok: true,
        reason: 'created_from_odoo',
        message: `✓ Mission VD Soft créée depuis Odoo (fleet #${odooLookup.odooVehicleId}) en zone ${zone}${enrichResult?.matched ? ` + enrichi TowSoft (${enrichResult.enriched_fields.length} champs)` : ''}`,
        match: {
          plate:      odooLookup.plate,
          vin:        odooLookup.vin,
          mission_id: odooLookup.missionId,
          source:     'legacy_odoo',
          towsoft_num: enrichResult?.towsoft_num || null,
        },
        parsed,
        vdsoft_mission_id:  odooLookup.missionId || null,
        towsoft_enriched:        enrichResult?.matched || false,
        towsoft_enriched_fields: enrichResult?.enriched_fields || [],
      })
    }

    const { data: orphan } = await sb
      .from('orphan_scans')
      .insert({
        raw_input:     raw,
        parsed_format: parsed.format,
        plate:         parsed.plate,
        vin:           parsed.vin,
        zone,
        scanned_by:    user.id,
        scanned_at:    new Date().toISOString(),
      })
      .select('id')
      .single()

    return NextResponse.json({
      ok: false,
      reason: 'not_in_towsoft',
      message: 'Véhicule absent de TowSoft / VD Soft / Odoo. À créer manuellement depuis PoliceClient. Loggé dans les fantômes inverses.',
      parsed,
      orphan_id: orphan?.id || null,
    })
  }

  // 3b. Deja scanne -> demander confirmation
  if (match.flag_scanned && !forceRescan && match.scanned_zone !== zone) {
    return NextResponse.json({
      ok:    false,
      reason: 'already_scanned',
      message: `Deja scanne en zone ${match.scanned_zone} le ${match.scanned_at}. Confirmer le changement vers ${zone} ?`,
      match,
    }, { status: 409 })
  }

  // 3c. Deja scanne meme zone (re-scan accidentel) -> succes idempotent
  if (match.flag_scanned && match.scanned_zone === zone) {
    return NextResponse.json({
      ok: true,
      reason: 'already_in_zone',
      message: `Deja scanne en ${zone} (re-scan idempotent)`,
      match,
    })
  }

  // 4. Marque flag_scanned + scanned_zone + scanned_at + qr_format
  const updates: Record<string, any> = {
    flag_scanned:     true,
    scanned_at:       new Date().toISOString(),
    scanned_zone:     zone,
    scanned_by_user:  user.id,
    scanned_qr_format: parsed.format,
    updated_at:       new Date().toISOString(),
  }
  // Si re-scan avec force_rescan, reset import pour que le worker re-cree avec la nouvelle zone
  if (forceRescan && match.flag_scanned) {
    updates.imported_at = null
    updates.import_attempts = 0
    updates.import_error = null
    updates.next_import_retry_at = new Date().toISOString()  // retry asap
  }

  const { error: upErr } = await sb
    .from('towsoft_migration_source')
    .update(updates)
    .eq('id', match.id)

  if (upErr) {
    console.error('[towsoft-migration/scan] update echec:', upErr.message)
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  // Olivier 2026-06-06 : creation INLINE de la mission VD Soft (le cron
  // towsoft-migration-import est desactive depuis l accord TowSoft CA, donc
  // il faut creer la mission VD Soft au moment du scan, pas plus tard).
  // VD Soft devient ainsi source de verite immediatement.
  let createdMissionId: string | null = null
  let workerError: string | null = null
  try {
    const result = await processMigrationFiche(match.id)
    if (result.ok) {
      createdMissionId = result.mission_id || null
      // Olivier 2026-06-06 : set migration_scanned_at / scanned_zone pour le
      // tracking auto-transfert Transit lors du Terminer zone.
      if (createdMissionId) {
        await markMigrationScanned(sb, createdMissionId, zone).catch(e =>
          console.warn('[scan] markMigrationScanned KO:', e?.message))
      }
    } else {
      workerError = result.reason || 'unknown'
      console.warn('[scan] processMigrationFiche KO:', result.reason)
    }
  } catch (e: any) {
    workerError = String(e?.message || e).slice(0, 200)
    console.warn('[scan] processMigrationFiche exception:', e?.message)
  }

  // Olivier 2026-06-04 : transfert state Odoo (synchrone, attendu pour
  // confirmer le mapping dans la UI). Si Odoo KO, le scan + creation
  // VD Soft restent valides, on signale juste le statut.
  let odooStateResult: any = null
  try {
    odooStateResult = await transferOdooState({
      plate:   match.plate || resolvedPlate,
      vin:     match.vin   || resolvedVin,
      zoneKey: zone,
      userId:  user.id,
    })
  } catch (e: any) {
    odooStateResult = { ok: false, reason: String(e?.message || e).slice(0, 200) }
  }

  // Olivier 2026-06-06 : impression etiquette parc inline (option print_label)
  // pour le workflow migration zone-par-zone. Non bloquant.
  let printResult: any = null
  if (printLabel && createdMissionId) {
    try {
      printResult = await reprintLabelForMission({ kind: 'uuid', value: createdMissionId })
    } catch (e: any) {
      printResult = { ok: false, error: String(e?.message || e).slice(0, 200) }
    }
  }

  return NextResponse.json({
    ok: true,
    reason: forceRescan ? 'rescanned_zone_changed' : 'scanned',
    message: `Scanné en ${zone} : ${match.plate || match.towsoft_num}`,
    match: { ...match, scanned_zone: zone, flag_scanned: true },
    parsed,
    // VD Soft = source de verite
    vdsoft_mission_id: createdMissionId,
    vdsoft_worker_error: workerError,
    // Odoo state mis a jour ?
    odoo_state_transferred: !!odooStateResult?.ok,
    odoo_state_reason: odooStateResult?.reason || null,
    // Impression etiquette
    label_printed: !!printResult?.ok,
    label_error:   printResult?.error || null,
  })
}

// ────────────────────────────────────────────────────────────────────
// Olivier 2026-06-04 : si on a un match Odoo mais ni TowSoft ni VD Soft,
// on cree une mission VD Soft minimaliste avec les infos Odoo + transfere
// le state Odoo vers la zone scannee. Idempotent via external_id ODOO-<id>.
// ────────────────────────────────────────────────────────────────────
async function createFromOdooIfFound(input: {
  plate:   string | null
  vin:     string | null
  zone:    string
  userId:  string
  sb:      any
}): Promise<{ ok: boolean; missionId?: string; odooVehicleId?: number; plate?: string | null; vin?: string | null }> {
  // 1. Lookup fleet.vehicle Odoo (best effort)
  let vehicle: any = null
  try {
    vehicle = await withOdooActor(input.userId, async () => {
      if (input.vin) {
        const r = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
          [['vin_sn', '=', String(input.vin).toUpperCase()]],
        ], { fields: ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id'], limit: 1 })
        if (r && r.length > 0) return r[0]
      }
      if (input.plate) {
        const r = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
          [['license_plate', '=', String(input.plate).toUpperCase()]],
        ], { fields: ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id'], limit: 1 })
        if (r && r.length > 0) return r[0]
      }
      return null
    })
  } catch (e: any) {
    console.warn('[scan] Odoo lookup KO:', e?.message)
    return { ok: false }
  }
  if (!vehicle) return { ok: false }

  const odooVehicleId = vehicle.id as number
  const externalId    = `ODOO-${odooVehicleId}`
  const brand         = Array.isArray(vehicle.brand_id) ? vehicle.brand_id[1] : null
  const model         = Array.isArray(vehicle.model_id) ? vehicle.model_id[1] : null

  // 2. Idempotence : mission VD Soft existante avec ce external_id ?
  const { data: existing } = await input.sb
    .from('incoming_missions')
    .select('id, parc_zone_key')
    .eq('external_id', externalId)
    .maybeSingle()

  if (existing) {
    // Update zone (idempotent re-scan)
    await input.sb.from('incoming_missions').update({
      parc_zone_key:   input.zone,
      parc_row_number: null,
      parc_slot_index: null,
      status:          'parked',
      updated_at:      new Date().toISOString(),
    }).eq('id', existing.id)
    await transferOdooState({ plate: vehicle.license_plate, vin: vehicle.vin_sn, zoneKey: input.zone, userId: input.userId })
      .catch(e => console.warn('[scan] transfer Odoo state KO:', e?.message))
    return { ok: true, missionId: existing.id, odooVehicleId, plate: vehicle.license_plate, vin: vehicle.vin_sn }
  }

  // 3. Cherche helpdesk.ticket Odoo associe au vehicule (pour helpdesk_id)
  let odooHelpdeskId: number | null = null
  try {
    odooHelpdeskId = await withOdooActor(input.userId, async () => {
      const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
        [['x_studio_fiche_vehicule', '=', odooVehicleId]],
      ], { fields: ['id'], limit: 1 })
      return tickets?.[0]?.id || null
    })
  } catch (e: any) {
    console.warn('[scan] Odoo helpdesk lookup KO:', e?.message)
  }

  // 4. INSERT mission VD Soft minimaliste
  const nowIso = new Date().toISOString()
  const { data: created, error: insErr } = await input.sb
    .from('incoming_missions')
    .insert({
      external_id:       externalId,
      source:            'legacy_odoo',
      mission_type:      'remorquage',
      status:            'parked',
      parc_zone_key:     input.zone,
      parc_row_number:   null,
      parc_slot_index:   null,
      vehicle_plate:     vehicle.license_plate || input.plate,
      vehicle_brand:     brand,
      vehicle_model:     model,
      vehicle_vin:       vehicle.vin_sn || input.vin,
      odoo_vehicle_id:   odooVehicleId,
      odoo_helpdesk_id:  odooHelpdeskId,
      received_at:       nowIso,
      intervention_date: nowIso,
      parked_at:         nowIso,
      created_at:        nowIso,
      updated_at:        nowIso,
    })
    .select('id')
    .single()

  if (insErr) {
    console.error('[scan] INSERT mission Odoo KO:', insErr.message)
    return { ok: false }
  }

  // 5. Log
  await input.sb.from('mission_logs').insert({
    mission_id: created.id,
    action:     'created_from_odoo_scan',
    notes:      `Mission VD Soft créée depuis Odoo (fleet.vehicle #${odooVehicleId}) au scan migration zone ${input.zone}`,
    actor_id:   input.userId,
    metadata:   { odoo_vehicle_id: odooVehicleId, odoo_helpdesk_id: odooHelpdeskId, to_zone: input.zone },
  }).then(() => {}, (e: any) => console.warn('[scan] log created_from_odoo KO:', e?.message))

  // 6. Transfert state Odoo (non bloquant)
  transferOdooState({ plate: vehicle.license_plate, vin: vehicle.vin_sn, zoneKey: input.zone, userId: input.userId })
    .catch(e => console.warn('[scan] transfer Odoo state KO:', e?.message))

  return { ok: true, missionId: created.id, odooVehicleId, plate: vehicle.license_plate, vin: vehicle.vin_sn }
}

// ────────────────────────────────────────────────────────────────────
// Olivier 2026-06-04 : transfert state Odoo au scan.
// Lookup fleet.vehicle par plaque ou VIN, puis update state_id vers le
// state_id de la zone scannee (mapping via FOURRIERE_ZONES). Best-effort.
// Wrap dans withOdooActor pour utiliser la cle perso de l operateur.
// ────────────────────────────────────────────────────────────────────
async function transferOdooState(input: {
  plate:   string | null
  vin:     string | null
  zoneKey: string
  userId:  string
}): Promise<{ ok: boolean; vehicleId?: number; newStateId?: number; reason?: string }> {
  const zoneConf = FOURRIERE_ZONES.find(z => z.code.toUpperCase() === input.zoneKey.toUpperCase())
  if (!zoneConf) {
    // Zone sans mapping Odoo (ex: J3 custom, Transit-Special, etc.) : on ne fait rien
    return { ok: false, reason: `Zone ${input.zoneKey} pas dans FOURRIERE_ZONES (pas de state_id Odoo)` }
  }
  const targetStateId = zoneConf.state_id

  return withOdooActor(input.userId, async () => {
    // Lookup fleet.vehicle par VIN d abord, sinon plaque (VIN plus fiable)
    let vehicleId: number | null = null
    if (input.vin) {
      const r = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
        [['vin_sn', '=', String(input.vin).toUpperCase()]],
      ], { fields: ['id', 'state_id'], limit: 1 })
      if (r && r.length > 0) vehicleId = r[0].id
    }
    if (!vehicleId && input.plate) {
      const r = await odooRpc<any[]>('fleet.vehicle', 'search_read', [
        [['license_plate', '=', String(input.plate).toUpperCase()]],
      ], { fields: ['id', 'state_id'], limit: 1 })
      if (r && r.length > 0) vehicleId = r[0].id
    }
    if (!vehicleId) {
      return { ok: false, reason: 'fleet.vehicle introuvable dans Odoo' }
    }

    // Update state_id
    await odooRpc('fleet.vehicle', 'write', [[vehicleId], { state_id: targetStateId }])
    return { ok: true, vehicleId, newStateId: targetStateId }
  })
}

// parseScanInput est importe depuis @/lib/towsoft-migration/parse-scan

// ────────────────────────────────────────────────────────────────────
// Olivier 2026-06-06 PM : MODE MANUEL — preview-only.
// Reproduit la decision tree du scan sans aucune ecriture en BDD/Odoo,
// afin que l operateur puisse valider visuellement avant que ca commit.
// L UI re-appelle l endpoint sans dry_run quand l operateur clique "Valider".
// ────────────────────────────────────────────────────────────────────
async function previewScan(input: {
  sb:           any
  raw:          string
  zone:         string
  parsed:       any
  forceRescan:  boolean
  printLabel:   boolean
}): Promise<NextResponse> {
  const { sb, raw, zone, parsed, printLabel } = input

  // Lookup TowSoft source (3 strategies : towsoft_num > VIN > plaque)
  let towsoftMatch: any = null
  if (parsed.towsoftNum) {
    const { data } = await sb.from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, client_name, date_entree, detail_payload, flag_scanned, scanned_zone, vdsoft_mission_id')
      .eq('towsoft_num', parsed.towsoftNum).maybeSingle()
    towsoftMatch = data
  }
  if (!towsoftMatch && parsed.vin) {
    const { data } = await sb.from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, client_name, date_entree, detail_payload, flag_scanned, scanned_zone, vdsoft_mission_id')
      .eq('vin', parsed.vin).limit(2)
    if (data && data.length === 1) towsoftMatch = data[0]
  }
  if (!towsoftMatch && parsed.plate) {
    const { data } = await sb.from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin, brand, model, motif, client_name, date_entree, detail_payload, flag_scanned, scanned_zone, vdsoft_mission_id')
      .eq('plate', parsed.plate).limit(2)
    if (data && data.length === 1) towsoftMatch = data[0]
  }

  // Lookup VD Soft existante par plaque/VIN (priorite VIN)
  let existingMission: any = null
  const searchVin   = parsed.vin   || towsoftMatch?.vin
  const searchPlate = parsed.plate || towsoftMatch?.plate
  if (searchVin) {
    const { data } = await sb.from('incoming_missions')
      .select('id, mission_number, external_id, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, client_name, status, parc_zone_key, source')
      .eq('vehicle_vin', searchVin)
      .in('status', ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering', 'parked'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (data) existingMission = data
  }
  if (!existingMission && searchPlate) {
    const { data } = await sb.from('incoming_missions')
      .select('id, mission_number, external_id, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, client_name, status, parc_zone_key, source')
      .eq('vehicle_plate', searchPlate)
      .in('status', ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering', 'parked'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (data) existingMission = data
  }

  // Determine action prevue + summary
  let action: string
  let summary: string
  let wouldEnrich: string[] = []

  if (towsoftMatch && towsoftMatch.flag_scanned && towsoftMatch.scanned_zone === zone && !input.forceRescan) {
    action = 'already_in_zone'
    summary = `Déjà scanné en ${zone} (re-scan idempotent)`
  } else if (towsoftMatch && towsoftMatch.flag_scanned && towsoftMatch.scanned_zone !== zone && !input.forceRescan) {
    action = 'already_scanned_elsewhere'
    summary = `⚠️ Déjà scanné en zone ${towsoftMatch.scanned_zone} — confirmer le changement vers ${zone} ?`
  } else if (existingMission) {
    action = 'enrich_existing_vdsoft'
    summary = `Mission VD Soft existante #${existingMission.mission_number} (${existingMission.source}, zone actuelle: ${existingMission.parc_zone_key || '—'}) → assignée à zone ${zone}`
    if (towsoftMatch) {
      summary += `\n+ Enrichissement TowSoft #${towsoftMatch.towsoft_num} (motif: ${towsoftMatch.motif || '—'})`
      // Estime quels champs SERAIENT enrichis (COALESCE)
      const detail = towsoftMatch.detail_payload || {}
      if (!existingMission.vehicle_brand && (towsoftMatch.brand || detail.marque)) wouldEnrich.push('vehicle_brand')
      if (!existingMission.vehicle_model && (towsoftMatch.model || detail.modele)) wouldEnrich.push('vehicle_model')
      if (!existingMission.client_name   && (detail.client_name || towsoftMatch.client_name)) wouldEnrich.push('client_name')
      if (detail.origine_addr)    wouldEnrich.push('incident_address')
      if (detail.dest_addr)       wouldEnrich.push('destination_address')
      if (detail.nom_responsable) wouldEnrich.push('officer_name')
      if (detail.numero_pv)       wouldEnrich.push('police_pv_number')
      if (detail.remarque)        wouldEnrich.push('remarks_general')
    }
  } else if (towsoftMatch) {
    action = 'create_new_from_towsoft'
    const detail = towsoftMatch.detail_payload || {}
    summary = `Nouvelle mission VD Soft (TS-${towsoftMatch.towsoft_num}, motif: ${towsoftMatch.motif || '—'}) → zone ${zone}`
    summary += `\nClient: ${detail.client_name || towsoftMatch.client_name || '—'}`
  } else {
    action = 'try_odoo_or_fantom'
    summary = `Aucun match TowSoft / VD Soft. Tentera lookup Odoo fleet.vehicle, sinon fantôme.`
  }

  return NextResponse.json({
    ok: true,
    dry_run: true,
    action,
    preview: {
      summary,
      parsed: { format: parsed.format, plate: parsed.plate, vin: parsed.vin, towsoftNum: parsed.towsoftNum },
      towsoft_match: towsoftMatch ? {
        towsoft_num: towsoftMatch.towsoft_num,
        plate:       towsoftMatch.plate,
        vin:         towsoftMatch.vin,
        brand:       towsoftMatch.brand,
        model:       towsoftMatch.model,
        motif:       towsoftMatch.motif,
        client_name: towsoftMatch.client_name,
        date_entree: towsoftMatch.date_entree,
        already_scanned_zone: towsoftMatch.flag_scanned ? towsoftMatch.scanned_zone : null,
      } : null,
      existing_mission: existingMission ? {
        id:             existingMission.id,
        mission_number: existingMission.mission_number,
        external_id:    existingMission.external_id,
        plate:          existingMission.vehicle_plate,
        vin:            existingMission.vehicle_vin,
        brand:          existingMission.vehicle_brand,
        model:          existingMission.vehicle_model,
        client_name:    existingMission.client_name,
        source:         existingMission.source,
        status:         existingMission.status,
        current_zone:   existingMission.parc_zone_key,
      } : null,
      would_enrich_fields: wouldEnrich,
      would_transfer_odoo_state: true,
      would_print_label: printLabel,
      target_zone: zone,
    },
  })
}
