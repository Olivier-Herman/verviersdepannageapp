// src/app/api/parc/bulk-assign-initial/route.ts
//
// POST /api/parc/bulk-assign-initial
//
// Bootstrap : attribue automatiquement une rangee + un emplacement a chaque
// vehicule Odoo en fourriere qui n a PAS de positionnement complet dans
// incoming_missions, selon sa zone Odoo.
//
// Comportement :
//   - Skip les vehicules deja entierement places (zone + rangee + slot ok).
//   - Pour chaque zone : utilise les rangees par sort_order, slots 1..capacity,
//     en excluant les slots bloques + members non-primary des groupes fusionnes
//     + slots deja occupes.
//   - Cree un incoming_missions stub si la mission VD Soft n existe pas encore
//     (idempotent via external_id = odoo-<id>).
//   - Met a jour incoming_missions existant si position partielle.
//
// Olivier l utilise une fois (initial) pour faire un placement plausible,
// puis corrige a l inventaire (les transferts se feront naturellement).
//
// Reponse : { ok, summary: [{ zone, placed, total, shortage }], total_placed, unmapped_zones }
//
// Permissions : admin/superadmin ou module 'fourriere'.

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

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const normalized = roles.map(r => String(r ?? '').toLowerCase())
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isAdmin = normalized.includes('admin') || normalized.includes('superadmin')
  if (!isAdmin && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Accès réservé aux gestionnaires fourrière.' }, { status: 403 })
  }

  const sb = createAdminClient()

  // 1. Vehicules Odoo en fourriere
  const odooVehicles = await odooCall<any[]>('fleet.vehicle', 'search_read', [
    [['state_id', 'in', FOURRIERE_STATE_IDS]],
  ], {
    fields: ['id', 'license_plate', 'brand_id', 'model_id', 'state_id'],
    limit:  3000,
  })

  // 2. parc_zones (clefs valides), parc_rows (avec capacite + sort_order)
  const [{ data: zonesData }, { data: rowsData }, { data: blockedData }, { data: groupsData }, { data: missionsData }] = await Promise.all([
    sb.from('parc_zones').select('key').eq('active', true),
    sb.from('parc_rows').select('zone_key, row_number, capacity, sort_order').order('zone_key').order('sort_order'),
    sb.from('parc_blocked_slots').select('zone_key, row_number, slot_index'),
    sb.from('parc_slot_groups').select('zone_key, row_number, slot_index, selection_order'),
    sb.from('incoming_missions')
      .select('id, vehicle_plate, status, parc_zone_key, parc_row_number, parc_slot_index')
      .in('status', ['parked']),
  ])

  const validZoneKeys = new Set((zonesData || []).map(z => z.key))
  // Mapping case-insensitive : FOURRIERE_ZONES.code ('BOX') -> parc_zones.key ('Box')
  const zoneByLower = new Map<string, string>()
  for (const k of validZoneKeys) zoneByLower.set(k.toLowerCase(), k)

  // 3. Rangees par zone, ordonnees par sort_order puis row_number
  const rowsByZone = new Map<string, Array<{ row: number; capacity: number }>>()
  for (const r of (rowsData || [])) {
    if (!rowsByZone.has(r.zone_key)) rowsByZone.set(r.zone_key, [])
    rowsByZone.get(r.zone_key)!.push({ row: r.row_number, capacity: r.capacity })
  }

  // 4. Sets de slots indisponibles
  const blockedSet = new Set((blockedData || []).map(b => `${b.zone_key}-${b.row_number}-${b.slot_index}`))
  const memberSet  = new Set((groupsData || []).filter(g => g.selection_order > 1).map(g => `${g.zone_key}-${g.row_number}-${g.slot_index}`))
  const occupiedSet = new Set(
    (missionsData || [])
      .filter(m => m.parc_zone_key && m.parc_row_number && m.parc_slot_index)
      .map(m => `${m.parc_zone_key}-${m.parc_row_number}-${m.parc_slot_index}`)
  )

  // 5. Slots dispo par zone (ordre row asc / slot asc)
  const availableByZone = new Map<string, Array<{ row: number; slot: number }>>()
  for (const zoneKey of validZoneKeys) {
    const list: Array<{ row: number; slot: number }> = []
    for (const r of (rowsByZone.get(zoneKey) || [])) {
      for (let s = 1; s <= r.capacity; s++) {
        const k = `${zoneKey}-${r.row}-${s}`
        if (blockedSet.has(k) || memberSet.has(k) || occupiedSet.has(k)) continue
        list.push({ row: r.row, slot: s })
      }
    }
    availableByZone.set(zoneKey, list)
  }

  // 6. Index missions par plaque
  const missionByPlate = new Map<string, any>()
  for (const m of (missionsData || [])) {
    const k = String(m.vehicle_plate || '').trim().toUpperCase()
    if (k && !missionByPlate.has(k)) missionByPlate.set(k, m)
  }

  // 7. Regroupe Odoo par zone (clef parc_zones, normalisee)
  const vehiclesByZone = new Map<string, Array<any>>()
  const unmappedZones = new Set<string>()
  for (const v of (odooVehicles || [])) {
    const stateId = v.state_id?.[0]
    const odooZone = stateId ? FOURRIERE_ZONE_BY_ID[stateId] : null
    if (!odooZone) continue
    const parcKey = zoneByLower.get(odooZone.code.toLowerCase())
    if (!parcKey) {
      unmappedZones.add(odooZone.code)
      continue
    }
    if (!vehiclesByZone.has(parcKey)) vehiclesByZone.set(parcKey, [])
    vehiclesByZone.get(parcKey)!.push({
      odoo_id: v.id,
      plate:   String(v.license_plate || '').trim().toUpperCase(),
      brand:   v.brand_id?.[1] || '',
      model:   v.model_id?.[1] || '',
    })
  }

  // 8. Tri deterministe : par plaque alphabetique pour chaque zone
  for (const [, vs] of vehiclesByZone) {
    vs.sort((a, b) => a.plate.localeCompare(b.plate))
  }

  // 9. Attribution sequentielle + plans d update / insert
  const summary: Array<{ zone: string; placed: number; total: number; shortage: number }> = []
  const toUpdate: Array<{ mission_id: string; zone: string; row: number; slot: number }> = []
  const toInsert: Array<{ external_id: string; plate: string; brand: string; model: string; zone: string; row: number; slot: number }> = []

  for (const [zoneKey, vehicles] of vehiclesByZone) {
    const available = availableByZone.get(zoneKey) || []
    let placed = 0
    let shortage = 0

    for (const v of vehicles) {
      if (!v.plate) continue
      const existing = missionByPlate.get(v.plate)
      // Skip si deja entierement place
      if (existing && existing.parc_zone_key && existing.parc_row_number && existing.parc_slot_index) {
        continue
      }
      // Plus de place dans la zone -> compte la penurie
      if (available.length === 0) {
        shortage++
        continue
      }
      const next = available.shift()!
      if (existing) {
        toUpdate.push({ mission_id: existing.id, zone: zoneKey, row: next.row, slot: next.slot })
      } else {
        toInsert.push({
          external_id: `odoo-${v.odoo_id}`,
          plate: v.plate, brand: v.brand, model: v.model,
          zone: zoneKey, row: next.row, slot: next.slot,
        })
      }
      placed++
    }

    summary.push({ zone: zoneKey, placed, total: vehicles.length, shortage })
  }

  // 10. Apply en parallele (chunks)
  async function runChunked<T>(items: T[], fn: (item: T) => Promise<any>, chunkSize = 20) {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize)
      await Promise.all(chunk.map(fn))
    }
  }

  await runChunked(toUpdate, async u => {
    await sb.from('incoming_missions').update({
      parc_zone_key:   u.zone,
      parc_row_number: u.row,
      parc_slot_index: u.slot,
    }).eq('id', u.mission_id)
  })

  if (toInsert.length > 0) {
    // INSERT bulk, ON CONFLICT (external_id) DO NOTHING au cas ou doublons
    const rows = toInsert.map(t => ({
      external_id:     t.external_id,
      source:          'fourriere_parc',
      source_format:   'odoo_parc',
      mission_type:    'fourriere',
      status:          'parked',
      vehicle_plate:   t.plate,
      vehicle_brand:   t.brand || null,
      vehicle_model:   t.model || null,
      parc_zone_key:   t.zone,
      parc_row_number: t.row,
      parc_slot_index: t.slot,
    }))
    // Supabase ne fait pas de upsert sur external_id "natif" -> on essaie un insert
    // simple; si erreur de doublons on log seulement (cas rare apres dedup en amont).
    const { error: insertErr } = await sb.from('incoming_missions').insert(rows)
    if (insertErr) {
      console.warn('[bulk-assign] insert error:', insertErr.message)
      // Retombe sur des inserts unitaires avec UPSERT-equivalent
      await runChunked(rows, async r => {
        const { data: exists } = await sb.from('incoming_missions').select('id').eq('external_id', r.external_id).maybeSingle()
        if (exists) {
          await sb.from('incoming_missions').update({
            parc_zone_key: r.parc_zone_key,
            parc_row_number: r.parc_row_number,
            parc_slot_index: r.parc_slot_index,
          }).eq('id', exists.id)
        } else {
          await sb.from('incoming_missions').insert(r as any)
        }
      })
    }
  }

  const totalPlaced = summary.reduce((s, x) => s + x.placed, 0)
  const totalShortage = summary.reduce((s, x) => s + x.shortage, 0)

  return NextResponse.json({
    ok: true,
    summary,
    total_placed:   totalPlaced,
    total_shortage: totalShortage,
    unmapped_zones: Array.from(unmappedZones),
  })
}
