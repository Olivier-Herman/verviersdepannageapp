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
      fields: ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id', 'write_date', 'create_date'],
      limit: 5000,
    })
  } catch (e: any) {
    return NextResponse.json({ error: `Odoo fetch echec : ${e.message}` }, { status: 500 })
  }

  // Fetch helpdesk.ticket lies a ces vehicules pour recuperer la VRAIE date
  // d intervention (x_studio_date_dentree) plutot que write_date du fleet.
  // Indexe par vehicle_id pour lookup rapide.
  const odooVehicleIds = odooVehicles.map(v => v.id).filter(Boolean)
  const interventionDateByVehicle = new Map<number, string>()
  const odooTicketIdByVehicle = new Map<number, number>()
  if (odooVehicleIds.length > 0) {
    try {
      const tickets = await odooCall<any[]>('helpdesk.ticket', 'search_read', [
        [
          '|',
          ['x_studio_vehicule', 'in', odooVehicleIds],
          ['x_studio_fiche_vehicule', 'in', odooVehicleIds],
        ],
      ], {
        fields: ['id', 'x_studio_vehicule', 'x_studio_fiche_vehicule', 'x_studio_date_dentree', 'create_date'],
        order:  'create_date DESC',  // on garde le plus recent par vehicule
        limit:  10000,
      })
      for (const t of (tickets || [])) {
        // Resoudre vehicle_id depuis x_studio_vehicule ou x_studio_fiche_vehicule (m2o)
        const vehicleId = Array.isArray(t.x_studio_fiche_vehicule)
          ? t.x_studio_fiche_vehicule[0]
          : (Array.isArray(t.x_studio_vehicule) ? t.x_studio_vehicule[0] : null)
        if (!vehicleId) continue
        if (interventionDateByVehicle.has(vehicleId)) continue  // garde le plus recent (order DESC)

        // Format date d entree Odoo : 'YYYY-MM-DD' ou 'YYYY-MM-DD HH:MM:SS'
        let dateStr: string | null = null
        if (t.x_studio_date_dentree) {
          // Date format Odoo : 'YYYY-MM-DD' -> ajoute T00:00:00 pour ISO
          const raw = String(t.x_studio_date_dentree)
          dateStr = raw.includes('T') ? raw : `${raw}T00:00:00`
        } else if (t.create_date) {
          // create_date Odoo : 'YYYY-MM-DD HH:MM:SS' -> remplace espace par T
          dateStr = String(t.create_date).replace(' ', 'T')
        }
        if (dateStr) {
          // Tente de parser pour valider
          const d = new Date(dateStr)
          if (isFinite(d.getTime())) {
            interventionDateByVehicle.set(vehicleId, d.toISOString())
            odooTicketIdByVehicle.set(vehicleId, t.id)
          }
        }
      }
      console.log(`[prepare-full-inventory] Dates intervention recuperees pour ${interventionDateByVehicle.size}/${odooVehicleIds.length} vehicules`)
    } catch (e: any) {
      console.error('[prepare-full-inventory] Fetch helpdesk tickets echec (non bloquant):', e.message)
    }
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

    // Date d intervention reelle (depuis ticket helpdesk si disponible),
    // sinon fallback create_date du fleet.vehicle, sinon write_date.
    // CRITIQUE pour les calculs : 60j AVP, jours gardiennage, etc.
    const realInterventionDate =
      interventionDateByVehicle.get(v.id) ||
      (v.create_date ? String(v.create_date).replace(' ', 'T') : null) ||
      v.write_date ||
      new Date().toISOString()
    const odooHelpdeskId = odooTicketIdByVehicle.get(v.id) || null

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
      odoo_helpdesk_id: odooHelpdeskId,
      received_at:       realInterventionDate,
      intervention_date: realInterventionDate,
      created_at:        new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    })

    stats.vehicles_to_create++
    stats.zones_distribution[zoneKey] = (stats.zones_distribution[zoneKey] || 0) + 1
  }

  if (stubsToCreate.length > 0 && !dryRun) {
    // Olivier 2026-06-03 : insert par batch + fallback insert un-par-un avec
    // log si un batch foire, pour identifier la zone problematique (FK error
    // sur parc_zone_key par exemple).
    const BATCH = 100
    let inserted = 0
    let skipped = 0
    const skipDetails: Array<{ plate: string; zone: string; error: string }> = []
    for (let i = 0; i < stubsToCreate.length; i += BATCH) {
      const slice = stubsToCreate.slice(i, i + BATCH)
      const { error } = await sb.from('incoming_missions').insert(slice)
      if (error) {
        // Fallback : insert un-par-un pour identifier les stubs problematiques
        for (const stub of slice) {
          const { error: e1 } = await sb.from('incoming_missions').insert(stub)
          if (e1) {
            skipped++
            skipDetails.push({
              plate: stub.vehicle_plate,
              zone:  stub.parc_zone_key,
              error: e1.message.slice(0, 200),
            })
          } else {
            inserted++
          }
        }
      } else {
        inserted += slice.length
      }
    }
    if (skipped > 0) {
      console.warn(`[prepare-full-inventory] ${skipped} stubs skipped sur ${stubsToCreate.length}`)
      // On retourne quand meme un succes partiel avec le detail
      return NextResponse.json({
        ok: true,
        stats,
        inserted,
        skipped,
        skipped_details: skipDetails.slice(0, 20),
        message: `${inserted} stubs crees, ${skipped} skipped (voir skipped_details)`,
      })
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
