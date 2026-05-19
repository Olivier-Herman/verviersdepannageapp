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

export const dynamic = 'force-dynamic'

const PARKED_STATUSES = ['parked', 'delivering']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  const [{ data: zones }, { data: rows }, { data: missions }, { data: settings }, { data: blocked }, { data: groupRows }] = await Promise.all([
    sb.from('parc_zones').select('*').eq('active', true).order('sort_order'),
    sb.from('parc_rows').select('*').order('zone_key').order('row_number'),
    sb.from('incoming_missions')
      .select('id, external_id, vehicle_plate, vehicle_brand, vehicle_model, client_name, status, parc_zone_key, parc_row_number, parc_slot_index, mission_type')
      .in('status', PARKED_STATUSES),
    sb.from('parc_settings').select('canvas_height_px').eq('id', 1).maybeSingle(),
    sb.from('parc_blocked_slots').select('zone_key, row_number, slot_index, reason'),
    sb.from('parc_slot_groups').select('group_uuid, zone_key, row_number, slot_index, selection_order').order('selection_order'),
  ])

  // Un vehicule n est "place" que s il a zone + rangee + slot tous determines.
  // Sinon il appartient a "a placer" -> sidebar pour qu il soit visible
  // et drag&drop-able vers une position complete.
  const placed   = (missions || []).filter(m => m.parc_zone_key && m.parc_row_number && m.parc_slot_index)
  const toPlace  = (missions || []).filter(m => !m.parc_zone_key || !m.parc_row_number || !m.parc_slot_index)

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
