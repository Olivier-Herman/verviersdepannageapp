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

  // 1. Cherche dans towsoft_migration_source (cas TowSoft non vu au scan initial)
  let towsoftMatch: any = null
  if (orphan.vin) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin')
      .eq('vin', orphan.vin)
      .maybeSingle()
    towsoftMatch = data
  }
  if (!towsoftMatch && orphan.plate) {
    const { data } = await sb
      .from('towsoft_migration_source')
      .select('id, towsoft_num, plate, vin')
      .eq('plate', orphan.plate)
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
  if (orphan.vin) {
    const { data } = await sb
      .from('incoming_missions')
      .select('id, mission_number, vehicle_plate, vehicle_vin, status, parc_zone_key, source')
      .eq('vehicle_vin', orphan.vin)
      .in('status', ['parked', 'delivering', 'created', 'assigned', 'in_progress'])
      .limit(2)
    if (data && data.length === 1) existingMission = data[0]
  }
  if (!existingMission && orphan.plate) {
    const { data } = await sb
      .from('incoming_missions')
      .select('id, mission_number, vehicle_plate, vehicle_vin, status, parc_zone_key, source')
      .eq('vehicle_plate', orphan.plate)
      .in('status', ['parked', 'delivering', 'created', 'assigned', 'in_progress'])
      .limit(2)
    if (data && data.length === 1) existingMission = data[0]
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
