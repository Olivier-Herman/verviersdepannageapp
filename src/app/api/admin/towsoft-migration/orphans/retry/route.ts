// src/app/api/admin/towsoft-migration/orphans/retry/route.ts
//
// POST /api/admin/towsoft-migration/orphans/retry
// Body: { id: string }
//
// Olivier 2026-06-04 : re-execute la logique de match pour un fantome inverse
// (orphan_scans) avec la nouvelle logique qui cherche aussi dans
// incoming_missions par plaque/VIN. Si trouve, lie la mission a la zone et
// marque l orphan comme resolu (action='linked_to_existing_vdsoft').

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { parseScanInput }    from '@/lib/towsoft-migration/parse-scan'

export const dynamic = 'force-dynamic'

interface Body {
  id: string
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

  const body = await req.json() as Body
  if (!body.id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()

  // Charge l orphan
  const { data: orphan, error: oErr } = await sb
    .from('orphan_scans')
    .select('*')
    .eq('id', body.id)
    .single()
  if (oErr || !orphan) return NextResponse.json({ error: 'Orphan introuvable' }, { status: 404 })
  if (orphan.resolved_at) return NextResponse.json({ error: 'Deja resolu' }, { status: 400 })

  // Olivier 2026-06-04 : re-parse raw_input pour gerer les formats qui
  // n etaient pas reconnus au scan initial (Odoo fleet URL, qr_mission, etc.)
  const parsed = parseScanInput(orphan.raw_input || '')

  // Resolution complete : cherche d abord par URL/ID dans incoming_missions
  // pour retrouver plate/vin, puis match dans les 2 tables
  let resolvedPlate: string | null = orphan.plate
  let resolvedVin:   string | null = orphan.vin
  let resolvedTowsoftNum: string | null = parsed.towsoftNum

  if (!resolvedTowsoftNum && (parsed.missionNum || parsed.ticketId || parsed.odooVehicleId)) {
    let missionQuery = sb
      .from('incoming_missions')
      .select('id, mission_number, external_id, vehicle_plate, vehicle_vin, odoo_helpdesk_id, odoo_vehicle_id')
      .limit(1)

    if (parsed.missionNum) {
      const isUuid = /^[0-9a-f-]{36}$/i.test(parsed.missionNum)
      const isNum  = /^\d+$/.test(parsed.missionNum)
      if (isUuid) missionQuery = missionQuery.eq('id', parsed.missionNum)
      else if (isNum) missionQuery = missionQuery.eq('mission_number', parseInt(parsed.missionNum, 10))
      else missionQuery = missionQuery.eq('id', parsed.missionNum)
    } else if (parsed.ticketId) {
      missionQuery = missionQuery.eq('odoo_helpdesk_id', parseInt(parsed.ticketId, 10))
    } else if (parsed.odooVehicleId) {
      missionQuery = missionQuery.eq('odoo_vehicle_id', parseInt(parsed.odooVehicleId, 10))
    }

    const { data: vdsMission } = await missionQuery.maybeSingle()
    if (vdsMission) {
      if (vdsMission.external_id && vdsMission.external_id.startsWith('TS-')) {
        resolvedTowsoftNum = vdsMission.external_id.replace(/^TS-/, '')
      }
      if (!resolvedPlate) resolvedPlate = vdsMission.vehicle_plate
      if (!resolvedVin)   resolvedVin   = vdsMission.vehicle_vin
    }
  }

  // 1. Cherche dans towsoft_migration_source
  let towsoftMatch: any = null
  if (resolvedTowsoftNum) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin')
      .eq('towsoft_num', resolvedTowsoftNum)
      .maybeSingle()
    towsoftMatch = data
  }
  if (!towsoftMatch && resolvedVin) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin')
      .eq('vin', resolvedVin)
      .maybeSingle()
    towsoftMatch = data
  }
  if (!towsoftMatch && resolvedPlate) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin')
      .eq('plate', resolvedPlate)
      .maybeSingle()
    towsoftMatch = data
  }

  if (towsoftMatch) {
    // Marque le flag_scanned dans towsoft_migration_source
    await sb
      .from('towsoft_migration_source')
      .update({
        flag_scanned:      true,
        scanned_at:        orphan.scanned_at,
        scanned_zone:      orphan.zone,
        scanned_by_user:   orphan.scanned_by,
        scanned_qr_format: orphan.parsed_format || 'retry',
        updated_at:        new Date().toISOString(),
      })
      .eq('id', towsoftMatch.id)

    // Marque l orphan comme resolu
    await sb.from('orphan_scans').update({
      resolved_at:         new Date().toISOString(),
      resolved_by:         user.id,
      resolved_action:     'linked_to_towsoft',
      resolution_notes:    `Re-tentative reussie : trouve dans TowSoft (n°${towsoftMatch.towsoft_num})`,
      updated_at:          new Date().toISOString(),
    }).eq('id', body.id)

    return NextResponse.json({
      ok: true,
      action: 'linked_to_towsoft',
      message: `✓ Trouvé dans TowSoft (n°${towsoftMatch.towsoft_num}) — flag scanné + zone ${orphan.zone}`,
    })
  }

  // 2. Cherche dans incoming_missions (cas mission VD Soft existante)
  let existingMission: any = null
  // Si parsed contient direct un mission/ticket/odoo id, on a deja cherche
  // via vdsMission ci-dessus. Re-faire ici par plate/vin couvre les cas
  // d orphans crees uniquement avec plate ou vin.
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
  // Si parsed contient odooVehicleId, ticketId, missionNum -> direct query
  if (!existingMission && (parsed.odooVehicleId || parsed.ticketId || parsed.missionNum)) {
    let q = sb
      .from('incoming_missions')
      .select('id, mission_number, vehicle_plate, vehicle_vin, status, parc_zone_key, source')
      .in('status', ['parked', 'delivering', 'created', 'assigned', 'in_progress'])
      .limit(1)
    if (parsed.odooVehicleId) q = q.eq('odoo_vehicle_id', parseInt(parsed.odooVehicleId, 10))
    else if (parsed.ticketId) q = q.eq('odoo_helpdesk_id', parseInt(parsed.ticketId, 10))
    else if (parsed.missionNum) {
      const isUuid = /^[0-9a-f-]{36}$/i.test(parsed.missionNum)
      const isNum  = /^\d+$/.test(parsed.missionNum)
      if (isUuid) q = q.eq('id', parsed.missionNum)
      else if (isNum) q = q.eq('mission_number', parseInt(parsed.missionNum, 10))
    }
    const { data } = await q.maybeSingle()
    if (data) existingMission = data
  }

  if (existingMission) {
    // Update zone
    const { error: upErr } = await sb
      .from('incoming_missions')
      .update({
        parc_zone_key:   orphan.zone,
        parc_row_number: null,
        parc_slot_index: null,
        status:          'parked',
        updated_at:      new Date().toISOString(),
      })
      .eq('id', existingMission.id)

    if (upErr) return NextResponse.json({ error: `Update mission KO : ${upErr.message}` }, { status: 500 })

    // Log audit
    await sb.from('mission_logs').insert({
      mission_id: existingMission.id,
      action:     'parc_scanned_migration_retry',
      notes:      `Re-tentative orphan : reassignee en zone ${orphan.zone}${existingMission.parc_zone_key && existingMission.parc_zone_key !== orphan.zone ? ` (depuis ${existingMission.parc_zone_key})` : ''}`,
      actor_id:   user.id,
      metadata:   {
        from_zone:  existingMission.parc_zone_key,
        to_zone:    orphan.zone,
        orphan_id:  body.id,
      },
    }).then(() => {}, e => console.warn('[orphan retry] log KO:', e?.message))

    // Marque l orphan comme resolu
    await sb.from('orphan_scans').update({
      resolved_at:         new Date().toISOString(),
      resolved_by:         user.id,
      resolved_action:     'linked_to_existing_vdsoft',
      resolved_mission_id: existingMission.id,
      resolution_notes:    `Re-tentative reussie : lie a mission VD Soft existante #${existingMission.mission_number || existingMission.id.slice(0, 8)}`,
      updated_at:          new Date().toISOString(),
    }).eq('id', body.id)

    return NextResponse.json({
      ok: true,
      action: 'linked_to_existing_vdsoft',
      mission_id: existingMission.id,
      message: `✓ Mission VD Soft existante liée à zone ${orphan.zone} (${existingMission.vehicle_plate || existingMission.vehicle_vin})`,
    })
  }

  // 3. Pas de match -> reste fantome
  return NextResponse.json({
    ok: false,
    action: 'no_match',
    message: 'Aucune mission VD Soft ni fiche TowSoft ne correspond. Reste à investiguer manuellement.',
  })
}
