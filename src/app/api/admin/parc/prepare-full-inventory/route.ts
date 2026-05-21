// src/app/api/admin/parc/prepare-full-inventory/route.ts
//
// POST /api/admin/parc/prepare-full-inventory
// Body : { dry_run?: boolean }
//
// Prepare VD Soft pour un inventaire complet du parc (~2h de scan terrain).
// Apres execution, VD Soft devient source de verite totale : tous les vehicules
// Odoo en fourriere ont une incoming_mission, regroupee par zone, et leurs
// rangee/slot sont vides pour etre re-places precisement au scan.
//
// 3 actions :
//   1. BULK SYNC : pour chaque fleet.vehicle Odoo en fourriere sans
//      incoming_mission VD Soft -> cree un stub avec :
//        - vehicle_plate, brand, model (depuis Odoo)
//        - parc_zone_key = FOURRIERE_ZONE_BY_ID[state_id].code (canonicalise)
//        - parc_row/slot = NULL (a placer au scan)
//        - status = 'parked'
//        - source = 'legacy_odoo'
//        - odoo_helpdesk_id = id du ticket helpdesk si trouve
//        - external_id = LEGACY-<plate>
//
//   2. CANONICALIZE : tous les incoming_missions parc_zone_key passent par
//      le mapping case-insensitive vers parc_zones.key canonique. Fixe les
//      mismatches historiques BOX vs Box, etc.
//
//   3. RESET PLACEMENT : pour tous les vehicules en parked/delivering,
//      clear parc_row_number et parc_slot_index (garde la zone).
//      => Apres ca tous les vehicules sont en "A placer" groupes par zone.
//      => L inventaire complet zone par zone re-place precisement.
//      => Les vehicules non scannes dans une zone -> unlocated (via
//         finish-zone existant).
//
// Permission : admin / superadmin uniquement.
//
// Mode dry_run : retourne ce qui SERAIT fait sans rien changer.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { FOURRIERE_STATE_IDS, FOURRIERE_ZONE_BY_ID } from '@/lib/fourriere'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

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

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const dryRun = Boolean(body.dry_run)

  const sb = createAdminClient()

  // ──────────── Etat actuel ────────────
  // Liste zones canoniques
  const { data: zones } = await sb.from('parc_zones').select('key').eq('active', true)
  const zoneCanon = new Map<string, string>()
  for (const z of (zones || [])) zoneCanon.set(String(z.key).toLowerCase(), z.key)
  function canon(k: string | null | undefined): string | null {
    if (!k) return null
    return zoneCanon.get(String(k).toLowerCase()) || k
  }

  // Liste vehicules Odoo en fourriere
  let odooVehicles: any[] = []
  try {
    odooVehicles = await odooCall<any[]>('fleet.vehicle', 'search_read', [
      [['state_id', 'in', FOURRIERE_STATE_IDS]],
    ], {
      fields: ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id', 'write_date'],
      limit: 5000,
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Odoo fetch echec : ${e.message}` }, { status: 500 })
  }

  // Liste missions VD Soft parked/delivering avec leur plaque
  const { data: vdMissions } = await sb
    .from('incoming_missions')
    .select('id, external_id, vehicle_plate, parc_zone_key, parc_row_number, parc_slot_index, status, odoo_helpdesk_id')
    .in('status', ['parked', 'delivering'])
  const vdByPlate = new Map<string, any>()
  for (const m of (vdMissions || [])) {
    const k = String(m.vehicle_plate || '').trim().toUpperCase()
    if (k && !vdByPlate.has(k)) vdByPlate.set(k, m)
  }

  // ──────────── Stats avant ────────────
  const stats = {
    odoo_vehicles:           odooVehicles.length,
    vd_soft_missions:        vdMissions?.length || 0,
    vehicles_to_create:      0,        // Odoo sans VD Soft mission
    vehicles_to_canonicalize: 0,       // VD Soft avec parc_zone_key non-canonique
    vehicles_to_reset_placement: 0,    // VD Soft avec row+slot non-null
    zones_distribution: {} as Record<string, number>,
  }

  // ──────────── 1. BULK SYNC (Odoo -> VD Soft) ────────────
  const stubsToCreate: any[] = []
  for (const v of odooVehicles) {
    const plate = String(v.license_plate || '').trim().toUpperCase()
    if (!plate || plate === 'PAS DE PLAQUE') continue
    if (vdByPlate.has(plate)) continue  // deja en VD Soft

    const stateId = v.state_id?.[0]
    const zoneMeta = stateId ? FOURRIERE_ZONE_BY_ID[stateId] : null
    if (!zoneMeta) continue

    const zoneKey = canon(zoneMeta.code) || zoneMeta.code
    const modelName = Array.isArray(v.model_id) ? v.model_id[1] : ''
    const brandName = Array.isArray(v.brand_id) ? v.brand_id[1] : ''
    const brand = brandName || modelName.split(/[\s\/]+/)[0] || ''
    const model = brandName ? modelName : modelName.split(/[\s\/]+/).slice(1).join(' ')

    stubsToCreate.push({
      external_id:     `LEGACY-${plate}-${v.id}`,
      vehicle_plate:   plate,
      vehicle_vin:     v.vin_sn || null,
      vehicle_brand:   brand || null,
      vehicle_model:   model || null,
      parc_zone_key:   zoneKey,
      parc_row_number: null,
      parc_slot_index: null,
      status:          'parked',
      source:          'legacy_odoo',
      mission_type:    null,
      received_at:     v.write_date || new Date().toISOString(),
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })

    stats.vehicles_to_create++
    stats.zones_distribution[zoneKey] = (stats.zones_distribution[zoneKey] || 0) + 1
  }

  if (stubsToCreate.length > 0 && !dryRun) {
    // Insert par batches de 100
    const BATCH = 100
    for (let i = 0; i < stubsToCreate.length; i += BATCH) {
      const slice = stubsToCreate.slice(i, i + BATCH)
      const { error } = await sb.from('incoming_missions').insert(slice)
      if (error) {
        return NextResponse.json({ error: `INSERT stubs echec : ${error.message}` }, { status: 500 })
      }
    }
  }

  // ──────────── 2. CANONICALIZE parc_zone_key ────────────
  const toCanon: Array<{ id: string; from: string; to: string }> = []
  for (const m of (vdMissions || [])) {
    if (!m.parc_zone_key) continue
    const canonized = canon(m.parc_zone_key)
    if (canonized && canonized !== m.parc_zone_key) {
      toCanon.push({ id: m.id, from: m.parc_zone_key, to: canonized })
      stats.vehicles_to_canonicalize++
      stats.zones_distribution[canonized] = (stats.zones_distribution[canonized] || 0) + 1
    } else {
      stats.zones_distribution[m.parc_zone_key] = (stats.zones_distribution[m.parc_zone_key] || 0) + 1
    }
  }
  if (toCanon.length > 0 && !dryRun) {
    // Group par target zone pour minimiser les calls
    const byTarget = new Map<string, string[]>()
    for (const t of toCanon) {
      if (!byTarget.has(t.to)) byTarget.set(t.to, [])
      byTarget.get(t.to)!.push(t.id)
    }
    for (const [to, ids] of byTarget) {
      await sb.from('incoming_missions').update({
        parc_zone_key: to, updated_at: new Date().toISOString(),
      }).in('id', ids)
    }
  }

  // ──────────── 3. RESET PLACEMENT (row+slot -> null) ────────────
  // On compte d abord pour le dry_run
  const { count: placementCount } = await sb
    .from('incoming_missions')
    .select('id', { count: 'exact', head: true })
    .in('status', ['parked', 'delivering'])
    .not('parc_row_number', 'is', null)
  stats.vehicles_to_reset_placement = placementCount || 0

  if (!dryRun && stats.vehicles_to_reset_placement > 0) {
    // Update tous les parked/delivering avec row/slot non null
    const { data: toReset } = await sb
      .from('incoming_missions')
      .select('id, parc_zone_key, parc_row_number, parc_slot_index')
      .in('status', ['parked', 'delivering'])
      .not('parc_row_number', 'is', null)
    const resetIds = (toReset || []).map(r => r.id)

    // Update en batches
    const BATCH = 200
    for (let i = 0; i < resetIds.length; i += BATCH) {
      const slice = resetIds.slice(i, i + BATCH)
      await sb.from('incoming_missions').update({
        parc_row_number: null,
        parc_slot_index: null,
        updated_at:      new Date().toISOString(),
      }).in('id', slice)
    }

    // Log mission_logs pour chaque vehicule reset (audit + rollback eventuel)
    const logs = (toReset || []).map(r => ({
      mission_id: r.id,
      actor_id:   user.id,
      action:     'prepared_for_full_inventory',
      notes:      `Placement reset pour inventaire complet : zone ${r.parc_zone_key} ${r.parc_row_number}-${r.parc_slot_index} libere.`,
      metadata:   {
        was_at: { zone: r.parc_zone_key, row: r.parc_row_number, slot: r.parc_slot_index },
      },
    }))
    if (logs.length > 0) {
      await sb.from('mission_logs').insert(logs).then(() => {}, () => {})
    }
  }

  return NextResponse.json({
    ok:       true,
    dry_run:  dryRun,
    stats,
    // Sample des changements pour visualisation (limite 20)
    samples: {
      stubs_to_create: stubsToCreate.slice(0, 20).map(s => ({
        plate: s.vehicle_plate, zone: s.parc_zone_key, brand: s.vehicle_brand,
      })),
      canonicalize: toCanon.slice(0, 20),
    },
  })
}
