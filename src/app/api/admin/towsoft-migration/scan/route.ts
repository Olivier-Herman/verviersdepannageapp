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

export const dynamic = 'force-dynamic'

interface ScanBody {
  raw_input:    string
  zone:         string
  force_rescan?: boolean
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

  if (!raw)  return NextResponse.json({ error: 'raw_input requis' }, { status: 400 })
  if (!zone) return NextResponse.json({ error: 'zone requise' }, { status: 400 })

  const sb = createAdminClient()

  // 1. Parse l input pour determiner le format
  const parsed = parseScanInput(raw)

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
          status:          existingMission.status === 'parked' ? 'parked' : 'parked',  // force parked si pas deja
          updated_at:      new Date().toISOString(),
        })
        .eq('id', existingMission.id)

      if (upErr) {
        return NextResponse.json({ error: `Update mission existante KO : ${upErr.message}` }, { status: 500 })
      }

      // Log audit
      await sb.from('mission_logs').insert({
        mission_id: existingMission.id,
        action:     'parc_scanned_migration',
        notes:      `Scan migration : reassignee en zone ${zone}${existingMission.parc_zone_key && existingMission.parc_zone_key !== zone ? ` (depuis ${existingMission.parc_zone_key})` : ''}`,
        actor_id:   user.id,
        metadata:   {
          from_zone:  existingMission.parc_zone_key,
          to_zone:    zone,
          raw_input:  raw,
          parsed_format: parsed.format,
        },
      }).then(() => {}, e => console.warn('[scan/migration] log KO:', e?.message))

      return NextResponse.json({
        ok: true,
        reason: 'linked_to_existing_vdsoft',
        message: `✓ Mission VD Soft existante liée à zone ${zone} (${existingMission.vehicle_plate || existingMission.vehicle_vin || 'plaque inconnue'})`,
        match: {
          plate: existingMission.vehicle_plate,
          vin:   existingMission.vehicle_vin,
          mission_id: existingMission.id,
          source: existingMission.source,
        },
        parsed,
      })
    }
  }

  // 3a. Pas de match -> fantome inverse (log dans orphan_scans pour suivi)
  if (!match) {
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
      message: 'Vehicule absent de TowSoft : a creer manuellement depuis PoliceClient OU verifier dans Odoo helpdesk. Logge dans la liste des fantomes inverses.',
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

  return NextResponse.json({
    ok: true,
    reason: forceRescan ? 'rescanned_zone_changed' : 'scanned',
    message: `Scanne en ${zone} : ${match.plate || match.towsoft_num}`,
    match: { ...match, scanned_zone: zone, flag_scanned: true },
    parsed,
  })
}

// parseScanInput est importe depuis @/lib/towsoft-migration/parse-scan
