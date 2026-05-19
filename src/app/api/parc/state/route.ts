// src/app/api/parc/state/route.ts
//
// GET /api/parc/state
// Renvoie tout ce qu'il faut pour afficher le plan visuel du parc :
//   - zones (figees)
//   - rows (par zone, avec capacite)
//   - missions placees (avec coordonnees)
//   - missions a placer (statut parked, zone vide)
//
// Acces : driver / dispatcher / admin / superadmin (tous lectures).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { FOURRIERE_STATE_IDS, FOURRIERE_ZONE_BY_ID } from '@/lib/fourriere'

export const dynamic = 'force-dynamic'

// Seuls les vehicules deja entres au parc (status = parked) sont sur le plan.
// 'delivering' = en route vers le parc, pas encore visible sur le plan.
const PARKED_STATUSES = ['parked']

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

/** Fetch Odoo fleet.vehicle dans les states fourriere. Renvoie une liste
 *  minimale pour la sidebar (id Odoo, plaque, marque, modele, zone). */
async function fetchOdooFourriereVehicles(): Promise<Array<{
  odoo_id: number
  plate: string
  brand: string
  model: string
  zone_code: string | null
}>> {
  try {
    const res = await fetch(`${ODOO_URL}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call', id: Date.now(),
        params: {
          service: 'object', method: 'execute_kw',
          args: [
            ODOO_DB, ODOO_UID, ODOO_API_KEY,
            'fleet.vehicle', 'search_read',
            [[['state_id', 'in', FOURRIERE_STATE_IDS]]],
            { fields: ['id', 'license_plate', 'brand_id', 'model_id', 'state_id'], limit: 2000 },
          ],
        },
      }),
    })
    const data = await res.json()
    if (data.error || !Array.isArray(data.result)) return []
    return data.result.map((v: any) => {
      const stateId = v.state_id?.[0]
      const zone = stateId ? FOURRIERE_ZONE_BY_ID[stateId] : null
      return {
        odoo_id:    v.id,
        plate:      String(v.license_plate || '').trim().toUpperCase(),
        brand:      v.brand_id?.[1] || '',
        model:      v.model_id?.[1] || '',
        zone_code:  zone?.code || null,
      }
    }).filter((v: any) => v.plate)  // pas d entree sans plaque
  } catch (e) {
    console.warn('[parc/state] Odoo fetch failed:', e)
    return []
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  const [
    { data: zones }, { data: rows }, { data: missions }, { data: settings },
    { data: blocked }, { data: groupRows }, odooFourriere,
  ] = await Promise.all([
    sb.from('parc_zones').select('*').eq('active', true).order('sort_order'),
    sb.from('parc_rows').select('*').order('zone_key').order('row_number'),
    sb.from('incoming_missions')
      .select('id, external_id, vehicle_plate, vehicle_brand, vehicle_model, client_name, status, parc_zone_key, parc_row_number, parc_slot_index, mission_type')
      .in('status', PARKED_STATUSES),
    sb.from('parc_settings').select('canvas_height_px').eq('id', 1).maybeSingle(),
    sb.from('parc_blocked_slots').select('zone_key, row_number, slot_index, reason'),
    sb.from('parc_slot_groups').select('group_uuid, zone_key, row_number, slot_index, selection_order').order('selection_order'),
    fetchOdooFourriereVehicles(),
  ])

  // Un vehicule n est "place" que s il a zone + rangee + slot tous determines.
  // Sinon il appartient a "a placer" -> sidebar pour qu il soit visible
  // et drag&drop-able vers une position complete.
  const placed   = (missions || []).filter(m => m.parc_zone_key && m.parc_row_number && m.parc_slot_index)
  const toPlace: any[] = (missions || []).filter(m => !m.parc_zone_key || !m.parc_row_number || !m.parc_slot_index)

  // Pour chaque vehicule Odoo en fourriere : si pas de mission parked
  // correspondante par plaque, on cree une entree virtuelle "odoo-<id>"
  // dans toPlace. Au drop, /api/parc/place creera la vraie mission.
  const placedPlates = new Set(
    (missions || [])
      .filter(m => m.parc_zone_key && m.parc_row_number && m.parc_slot_index)
      .map(m => String(m.vehicle_plate || '').trim().toUpperCase())
      .filter(Boolean)
  )
  const toPlacePlates = new Set(
    toPlace.map(m => String(m.vehicle_plate || '').trim().toUpperCase()).filter(Boolean)
  )
  for (const v of odooFourriere) {
    if (placedPlates.has(v.plate) || toPlacePlates.has(v.plate)) continue
    toPlace.push({
      id:               `odoo-${v.odoo_id}`,
      external_id:      `odoo-${v.odoo_id}`,
      vehicle_plate:    v.plate,
      vehicle_brand:    v.brand,
      vehicle_model:    v.model,
      client_name:      null,
      status:           'odoo_only',
      mission_type:     null,
      parc_zone_key:    v.zone_code,
      parc_row_number:  null,
      parc_slot_index:  null,
      _virtual:         true,
      _odoo_id:         v.odoo_id,
    })
  }

  // Regroupe les lignes parc_slot_groups par group_uuid (members + primary)
  const groupsMap = new Map<string, { group_uuid: string; primary: any; members: any[] }>()
  for (const g of (groupRows || [])) {
    const slot = { zone_key: g.zone_key, row_number: g.row_number, slot_index: g.slot_index }
    if (!groupsMap.has(g.group_uuid)) {
      groupsMap.set(g.group_uuid, { group_uuid: g.group_uuid, primary: slot, members: [] })
    } else {
      groupsMap.get(g.group_uuid)!.members.push(slot)
    }
  }
  const merged_groups = Array.from(groupsMap.values())

  return NextResponse.json({
    zones:           zones || [],
    rows:            rows  || [],
    placed,
    toPlace,
    blocked:         blocked || [],
    merged_groups,
    canvasHeightPx:  settings?.canvas_height_px || 2400,
  })
}
