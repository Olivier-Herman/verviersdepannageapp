// src/app/api/admin/parc/diag-zone/route.ts
//
// GET /api/admin/parc/diag-zone?zone_key=Box
//
// Diagnostic complet d une zone : croise les vehicules Odoo (state_id de la
// zone) avec les missions VD Soft (parc_zone_key) pour identifier les
// vehicules invisibles dans le plan ou en discrepancy.
//
// Reponse :
//   - odoo_total : nb vehicules Odoo en zone
//   - vd_soft_total : nb missions VD Soft avec parc_zone_key = zone
//   - discrepancies :
//     * in_odoo_not_in_vd_soft : plaques Odoo sans mission VD Soft
//     * in_vd_soft_wrong_status : missions VD Soft en zone mais avec status non parked
//     * in_vd_soft_no_placement : missions parked mais sans row/slot
//     * in_vd_soft_out_of_capacity : missions placees au-dela de la capacite
//     * mismatched_zone_case : missions avec parc_zone_key dans une autre casse
//
// Acces : admin / superadmin

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { FOURRIERE_ZONES }   from '@/lib/fourriere'

export const dynamic = 'force-dynamic'

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

async function odooCall<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs],
      },
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo ${model}.${method}: ${JSON.stringify(data.error)}`)
  return data.result
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const zoneKey = (searchParams.get('zone_key') || '').trim()
  if (!zoneKey) return NextResponse.json({ error: 'zone_key requis' }, { status: 400 })

  const sb = createAdminClient()

  // 1. Trouve le state_id Odoo de cette zone (case-insensitive)
  const zoneMeta = FOURRIERE_ZONES.find(z => z.code.toLowerCase() === zoneKey.toLowerCase())
  if (!zoneMeta) {
    return NextResponse.json({ error: `Zone ${zoneKey} introuvable dans FOURRIERE_ZONES` }, { status: 404 })
  }

  // 2. Fetch vehicules Odoo en zone
  let odooVehicles: any[] = []
  try {
    odooVehicles = await odooCall<any[]>('fleet.vehicle', 'search_read', [
      [['state_id', '=', zoneMeta.state_id]],
    ], {
      fields: ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id'],
      limit: 2000,
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Odoo fetch failed: ${e.message}` }, { status: 500 })
  }
  const odooPlates = new Set<string>(
    (odooVehicles || []).map((v: any) => String(v.license_plate || '').trim().toUpperCase()).filter(Boolean)
  )

  // 3. Fetch capacites des rangees de la zone
  const { data: rows } = await sb
    .from('parc_rows')
    .select('row_number, capacity')
    .eq('zone_key', zoneKey)
  const rowCapacity = new Map<number, number>()
  for (const r of (rows || [])) rowCapacity.set(Number(r.row_number), Number(r.capacity) || 0)

  // 4. Fetch missions VD Soft avec parc_zone_key = zone (case-insensitive via OR sur 2 variantes)
  //    On cherche aussi avec la casse opposee pour detecter le mismatch
  const variants = [zoneKey, zoneKey.toLowerCase(), zoneKey.toUpperCase()].filter((v, i, arr) => arr.indexOf(v) === i)
  const { data: vdMissions } = await sb
    .from('incoming_missions')
    .select('id, external_id, vehicle_plate, status, parc_zone_key, parc_row_number, parc_slot_index, updated_at')
    .in('parc_zone_key', variants)
    .order('updated_at', { ascending: false })

  const vdByPlate = new Map<string, any>()
  for (const m of (vdMissions || [])) {
    const k = String(m.vehicle_plate || '').trim().toUpperCase()
    if (k && !vdByPlate.has(k)) vdByPlate.set(k, m)
  }

  // 5. Analyse discrepancies
  const in_odoo_not_in_vd_soft: any[] = []
  const in_vd_soft_wrong_status: any[] = []
  const in_vd_soft_no_placement: any[] = []
  const in_vd_soft_out_of_capacity: any[] = []
  const mismatched_zone_case: any[] = []
  const fully_ok: any[] = []

  for (const v of (odooVehicles || [])) {
    const plate = String(v.license_plate || '').trim().toUpperCase()
    if (!plate) continue
    const mission = vdByPlate.get(plate)
    if (!mission) {
      in_odoo_not_in_vd_soft.push({ plate, odoo_id: v.id })
      continue
    }
    // Case mismatch
    if (mission.parc_zone_key !== zoneKey) {
      mismatched_zone_case.push({
        plate, mission_id: mission.id,
        odoo_zone: zoneKey,
        vd_soft_zone: mission.parc_zone_key,
      })
      continue
    }
    // Status non parked
    if (mission.status !== 'parked') {
      in_vd_soft_wrong_status.push({
        plate, mission_id: mission.id, status: mission.status,
        parc_row_number: mission.parc_row_number,
        parc_slot_index: mission.parc_slot_index,
      })
      continue
    }
    // Pas de row/slot
    if (!mission.parc_row_number || !mission.parc_slot_index) {
      in_vd_soft_no_placement.push({
        plate, mission_id: mission.id,
        row: mission.parc_row_number, slot: mission.parc_slot_index,
      })
      continue
    }
    // Out of capacity
    const cap = rowCapacity.get(Number(mission.parc_row_number)) || 0
    if (cap > 0 && Number(mission.parc_slot_index) > cap) {
      in_vd_soft_out_of_capacity.push({
        plate, mission_id: mission.id,
        row: mission.parc_row_number,
        slot: mission.parc_slot_index,
        capacity: cap,
      })
      continue
    }
    fully_ok.push({
      plate, mission_id: mission.id,
      row: mission.parc_row_number, slot: mission.parc_slot_index,
    })
  }

  return NextResponse.json({
    zone_key:      zoneKey,
    state_id:      zoneMeta.state_id,
    odoo_total:    odooVehicles?.length || 0,
    vd_soft_total: vdMissions?.length || 0,
    summary: {
      fully_ok_count:                 fully_ok.length,
      in_odoo_not_in_vd_soft_count:   in_odoo_not_in_vd_soft.length,
      in_vd_soft_wrong_status_count:  in_vd_soft_wrong_status.length,
      in_vd_soft_no_placement_count:  in_vd_soft_no_placement.length,
      in_vd_soft_out_of_capacity_count: in_vd_soft_out_of_capacity.length,
      mismatched_zone_case_count:     mismatched_zone_case.length,
    },
    discrepancies: {
      in_odoo_not_in_vd_soft,
      in_vd_soft_wrong_status,
      in_vd_soft_no_placement,
      in_vd_soft_out_of_capacity,
      mismatched_zone_case,
    },
  })
}
