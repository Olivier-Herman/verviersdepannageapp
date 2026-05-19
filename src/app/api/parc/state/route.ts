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

  const [{ data: zones }, { data: rows }, { data: missions }, { data: settings }] = await Promise.all([
    sb.from('parc_zones').select('*').eq('active', true).order('sort_order'),
    sb.from('parc_rows').select('*').order('zone_key').order('row_number'),
    sb.from('incoming_missions')
      .select('id, external_id, vehicle_plate, vehicle_brand, vehicle_model, client_name, status, parc_zone_key, parc_row_number, parc_slot_index, mission_type')
      .in('status', PARKED_STATUSES),
    sb.from('parc_settings').select('canvas_height_px').eq('id', 1).maybeSingle(),
  ])

  const placed   = (missions || []).filter(m => m.parc_zone_key && m.parc_row_number)
  const toPlace  = (missions || []).filter(m => !m.parc_zone_key || !m.parc_row_number)

  return NextResponse.json({
    zones:           zones || [],
    rows:            rows  || [],
    placed,
    toPlace,
    canvasHeightPx:  settings?.canvas_height_px || 2400,
  })
}
