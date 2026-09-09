// src/app/api/parc/state/route.ts
//
// GET /api/parc/state
// Renvoie tout ce qu'il faut pour afficher le plan visuel du parc, depuis VD Soft
// uniquement (plus de véhicules « Odoo seulement » : les états Odoo ne sont plus
// synchronisés — Olivier 09/09/2026) :
//   - zones (parc_zones)
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

// Seuls les vehicules deja entres au parc (status = parked) sont sur le plan.
// 'delivering' = en route vers le parc, pas encore visible sur le plan.
const PARKED_STATUSES = ['parked']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()

  // 1er round : tout sauf les missions par plaque Odoo (qu on fetch apres)
  const [
    { data: zones }, { data: rows }, { data: parkedMissions }, { data: settings },
    { data: blocked }, { data: groupRows },
  ] = await Promise.all([
    sb.from('parc_zones').select('*').eq('active', true).order('sort_order'),
    sb.from('parc_rows').select('*').order('zone_key').order('row_number'),
    sb.from('incoming_missions')
      .select('id, external_id, vehicle_plate, vehicle_brand, vehicle_model, client_name, status, parc_zone_key, parc_row_number, parc_slot_index, mission_type, source, saisie_motif_code')
      .in('status', PARKED_STATUSES),
    sb.from('parc_settings').select('canvas_height_px').eq('id', 1).maybeSingle(),
    sb.from('parc_blocked_slots').select('zone_key, row_number, slot_index, reason'),
    sb.from('parc_slot_groups').select('group_uuid, zone_key, row_number, slot_index, selection_order').order('selection_order'),
  ])

  // Set des zones pool (bordel) : pour ces zones, un vehicule est considere
  // place des qu il a parc_zone_key (pas besoin de rangee/slot).
  const poolZoneKeys = new Set<string>((zones || []).filter((z: any) => z.is_pool).map((z: any) => z.key))

  // Mapping case-insensitive : FOURRIERE_ZONES.code (uppercase ex 'BOX') -> parc_zones.key (canonique ex 'Box')
  // Necessaire car les vehicules Odoo virtuels (toPlace) ont zone_code en uppercase
  // mais le frontend group par parc_zones.key. Sans ce mapping, ils sont invisibles
  // dans le sidebar "A placer".
  const zoneKeyCanon = new Map<string, string>()
  for (const z of (zones || [])) {
    zoneKeyCanon.set(String(z.key).toLowerCase(), z.key)
  }
  function canonZoneKey(k: string | null | undefined): string | null {
    if (!k) return null
    return zoneKeyCanon.get(String(k).toLowerCase()) || k
  }

  // Canonicalize parc_zone_key des missions AVANT le isFullyPlaced
  // (pool check + frontend grouping fonctionnent sur key canonique).
  const parkedNormalized = (parkedMissions || []).map((m: any) => ({
    ...m,
    parc_zone_key: canonZoneKey(m.parc_zone_key),
  }))

  // Un vehicule n est "place" que s il a zone + rangee + slot tous determines,
  // sauf en zone pool ou seule la zone suffit.
  const isFullyPlaced = (m: any) => {
    if (!m.parc_zone_key) return false
    if (poolZoneKeys.has(m.parc_zone_key)) return true
    return !!(m.parc_row_number && m.parc_slot_index)
  }
  const placed   = parkedNormalized.filter(isFullyPlaced)
  const toPlace: any[] = parkedNormalized.filter(m => !isFullyPlaced(m))

  // Regroupe les lignes parc_slot_groups par group_uuid (members + primary)
  const groupsMap = new Map<string, { group_uuid: string; primary: any; members: any[] }>()
  for (const g of (groupRows || [])) {
    const slot = { zone_key: canonZoneKey(g.zone_key)!, row_number: g.row_number, slot_index: g.slot_index }
    if (!groupsMap.has(g.group_uuid)) {
      groupsMap.set(g.group_uuid, { group_uuid: g.group_uuid, primary: slot, members: [] })
    } else {
      groupsMap.get(g.group_uuid)!.members.push(slot)
    }
  }
  const merged_groups = Array.from(groupsMap.values())

  // Canonicalize blocked aussi (placed est deja normalise via parkedNormalized).
  // Le frontend construit ses Map<"zone-row-slot"> et match avec zones.key
  // canonique - sans canon -> mismatch BOX/Box -> slots bloques invisibles
  // = impossible a debloquer (le bug Olivier).
  const blockedCanon = (blocked || []).map((b: any) => ({
    ...b,
    zone_key: canonZoneKey(b.zone_key),
  }))

  return NextResponse.json({
    zones:           zones || [],
    rows:            rows  || [],
    placed,
    toPlace,
    blocked:         blockedCanon,
    merged_groups,
    canvasHeightPx:  settings?.canvas_height_px || 2400,
  })
}
