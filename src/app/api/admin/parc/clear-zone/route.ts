// src/app/api/admin/parc/clear-zone/route.ts
//
// POST /api/admin/parc/clear-zone
// Body : { zone_key: string, dry_run?: boolean }
//
// Vide entierement une zone du parc : tous les vehicules de la zone
// (status 'parked'/'delivering') voient leur parc_zone_key/row/slot mis a null.
// Ils apparaissent ensuite dans la liste "A placer" sur le plan, et au scan
// dans une zone ils retrouvent leur place.
//
// On garde une trace dans mission_logs pour chaque vehicule (ancien emplacement
// + zone d origine + acteur) pour pouvoir reconstruire l historique en cas de
// besoin (audit, recherche, etc.).
//
// Acces : admin / superadmin / module fourriere

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

// Olivier 2026-06-04 : doctrine "si elles sont en zone, elles doivent etre
// en parked". On vide donc TOUTES les missions ayant parc_zone_key=X, peu
// importe leur status. Les missions stale (in_progress/assigned avec une
// zone parc) sont une incoherence a nettoyer.

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const zoneKey = String(body.zone_key || '').trim()
  const dryRun  = Boolean(body.dry_run)
  if (!zoneKey) return NextResponse.json({ error: 'zone_key requis' }, { status: 400 })

  const sb = createAdminClient()

  // 1. Liste les vehicules actuellement dans la zone (tous statuts)
  const { data: vehicles, error: vErr } = await sb
    .from('incoming_missions')
    .select('id, vehicle_plate, parc_zone_key, parc_row_number, parc_slot_index, status')
    .eq('parc_zone_key', zoneKey)
    .order('parc_row_number')
    .order('parc_slot_index')

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })
  const list = vehicles || []

  if (list.length === 0) {
    return NextResponse.json({ ok: true, cleared: 0, count: 0, vehicles: [], message: `Aucun vehicule dans la zone ${zoneKey}` })
  }

  if (dryRun) {
    return NextResponse.json({
      ok:       true,
      dry_run:  true,
      cleared:  list.length,
      count:    list.length,
      vehicles: list,
    })
  }

  // 2. Clear positions
  const ids = list.map(v => v.id)
  const now = new Date().toISOString()
  const { error: upErr } = await sb
    .from('incoming_missions')
    .update({
      parc_zone_key:   null,
      parc_row_number: null,
      parc_slot_index: null,
      updated_at:      now,
    })
    .in('id', ids)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // 3. Log mission_logs pour chaque vehicule (trace de l ancien emplacement)
  const logs = list.map(v => ({
    mission_id: v.id,
    actor_id:   user.id,
    action:     'zone_cleared',
    notes:      `Sorti du parc par "Vider zone ${zoneKey}". Ancien emplacement : ${zoneKey}${v.parc_row_number || ''}-${v.parc_slot_index || ''}.`,
    metadata:   {
      reason:    'manual_zone_clear',
      zone_key:  zoneKey,
      was_at:    {
        zone:   zoneKey,
        row:    v.parc_row_number,
        slot:   v.parc_slot_index,
      },
    },
  }))
  await sb.from('mission_logs').insert(logs).then(() => {}, () => {})

  return NextResponse.json({
    ok:       true,
    cleared:  list.length,
    count:    list.length,
    zone_key: zoneKey,
    vehicles: list,
  })
}
