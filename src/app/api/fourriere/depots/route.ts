// src/app/api/fourriere/depots/route.ts
//
// GET /api/fourriere/depots
// Liste les parcs/depots actifs avec le nombre de vehicules actuellement
// presents. Utilise par la modale "Acceder aux parcs" (tuiles).
//
// Olivier 2026-06-03.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ACTIVE_PARC_STATUSES = ['parked', 'delivering', 'unlocated', 'awaiting_payment']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  const { data: depots, error: e1 } = await sb
    .from('depots')
    .select('id, name, address, is_default_parc, sort_order')
    .eq('active', true)
    .order('sort_order')
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // Mapper zones par depot
  const { data: zones, error: e2 } = await sb
    .from('parc_zones')
    .select('key, depot_id')
    .eq('active', true)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  const zoneToDepot = new Map<string, string | null>()
  const depotZoneCount = new Map<string, number>()
  for (const z of (zones || [])) {
    zoneToDepot.set(z.key, z.depot_id || null)
    if (z.depot_id) depotZoneCount.set(z.depot_id, (depotZoneCount.get(z.depot_id) || 0) + 1)
  }

  // Compter les vehicules par depot (via parc_zone_key)
  const { data: missions, error: e3 } = await sb
    .from('incoming_missions')
    .select('parc_zone_key')
    .in('status', ACTIVE_PARC_STATUSES)
    .not('parc_zone_key', 'is', null)
  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 })

  const depotVehCount = new Map<string, number>()
  for (const m of (missions || [])) {
    if (!m.parc_zone_key) continue
    const dId = zoneToDepot.get(m.parc_zone_key)
    if (dId) depotVehCount.set(dId, (depotVehCount.get(dId) || 0) + 1)
  }

  const result = (depots || []).map(d => ({
    id:              d.id,
    name:            d.name,
    address:         d.address,
    is_default_parc: d.is_default_parc,
    zone_count:      depotZoneCount.get(d.id) || 0,
    vehicle_count:   depotVehCount.get(d.id)  || 0,
  }))

  return NextResponse.json({ depots: result })
}
