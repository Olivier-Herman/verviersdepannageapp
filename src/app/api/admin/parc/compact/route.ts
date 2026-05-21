// src/app/api/admin/parc/compact/route.ts
//
// POST /api/admin/parc/compact
// Body : { zone_key?: string }    (optionnel : limite a une seule zone)
// Body : { dry_run?: boolean }    (optionnel : ne fait rien, juste un rapport)
//
// One-shot de maintenance : scanne toutes les rangees du parc (ou une zone
// specifique) et compacte les slots pour bouchonner les trous. Renumerote
// chaque rangee 1..N en gardant l ordre relatif des occupants restants.
//
// Utile pour rattraper l historique : si des voitures ont ete facturees /
// no-charged avant que le shift automatique soit en place, leurs slots sont
// fantomes (occupes en BDD par des status='completed' mais filtres en UI).
// Le compact les remet en ordre.
//
// Acces : admin / superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const PARKED_STATUSES = ['parked', 'delivering']

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const onlyZone = body.zone_key ? String(body.zone_key).trim() : null
  const dryRun = Boolean(body.dry_run)

  const sb = createAdminClient()

  // Liste des zones pool (is_pool=true) : pas de notion de rangee/slot, donc
  // pas de shift possible. On les skip.
  const { data: poolZones } = await sb
    .from('parc_zones')
    .select('key')
    .eq('is_pool', true)
  const poolKeys = new Set<string>((poolZones || []).map((z: any) => z.key))

  // Liste des rangees qui contiennent au moins un slot merge (parc_slot_groups).
  // Shifter dans une rangee mergee casserait le groupe -> skip.
  const { data: mergedSlots } = await sb
    .from('parc_slot_groups')
    .select('zone_key, row_number')
  const mergedRowKeys = new Set<string>(
    (mergedSlots || []).map((s: any) => `${s.zone_key}-${s.row_number}`)
  )

  // Recupere toutes les missions placees (parc_zone_key + row + slot non null).
  let q = sb
    .from('incoming_missions')
    .select('id, vehicle_plate, parc_zone_key, parc_row_number, parc_slot_index, status')
    .not('parc_zone_key',   'is', null)
    .not('parc_row_number', 'is', null)
    .not('parc_slot_index', 'is', null)
  if (onlyZone) q = q.eq('parc_zone_key', onlyZone)

  const { data: allPlaced, error } = await q.order('parc_zone_key').order('parc_row_number').order('parc_slot_index')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Etape 1 : cleanup des fantomes (status non parc avec position). Clear leur position.
  const ghosts = (allPlaced || []).filter(m => !PARKED_STATUSES.includes(m.status))
  if (ghosts.length > 0 && !dryRun) {
    await sb
      .from('incoming_missions')
      .update({ parc_zone_key: null, parc_row_number: null, parc_slot_index: null })
      .in('id', ghosts.map(g => g.id))
  }

  // Etape 2 : compacter chaque rangee
  const activeOccupants = (allPlaced || []).filter(m => PARKED_STATUSES.includes(m.status))
  const byRow = new Map<string, typeof activeOccupants>()
  for (const m of activeOccupants) {
    const key = `${m.parc_zone_key}-${m.parc_row_number}`
    const list = byRow.get(key) || []
    list.push(m)
    byRow.set(key, list)
  }

  const report: Array<{
    zone:      string
    row:       number
    before:    Array<{ slot: number; plate: string | null }>
    after:     Array<{ slot: number; plate: string | null }>
    changed:   number
  }> = []

  for (const [key, occupants] of byRow) {
    occupants.sort((a, b) => (a.parc_slot_index as number) - (b.parc_slot_index as number))
    const zone = occupants[0].parc_zone_key as string
    const row  = occupants[0].parc_row_number as number

    // Skip si zone pool (pas de notion de rangee/slot)
    if (poolKeys.has(zone)) continue
    // Skip si la rangee contient au moins un slot merge (groupe protege)
    if (mergedRowKeys.has(`${zone}-${row}`)) continue

    const before = occupants.map(o => ({ slot: o.parc_slot_index as number, plate: o.vehicle_plate }))
    const after  = occupants.map((o, i) => ({ slot: i + 1, plate: o.vehicle_plate }))
    const changed = occupants.filter((o, i) => (o.parc_slot_index as number) !== i + 1).length

    if (changed === 0) continue
    report.push({ zone, row, before, after, changed })

    if (dryRun) continue

    // Shift en 2 passes pour eviter les collisions UNIQUE (zone, row, slot) :
    // pass 1 : decale tous ceux qui changent vers slot+1000
    // pass 2 : remet a target final
    for (let i = 0; i < occupants.length; i++) {
      const occ = occupants[i]
      const target = i + 1
      if (occ.parc_slot_index === target) continue
      await sb.from('incoming_missions').update({
        parc_slot_index: target + 1000,
      }).eq('id', occ.id)
    }
    for (let i = 0; i < occupants.length; i++) {
      const occ = occupants[i]
      const target = i + 1
      if (occ.parc_slot_index === target) continue
      await sb.from('incoming_missions').update({
        parc_slot_index: target,
      }).eq('id', occ.id)
    }
  }

  return NextResponse.json({
    ok:           true,
    dry_run:      dryRun,
    zone_filter:  onlyZone,
    ghosts_cleaned: ghosts.length,
    rows_compacted: report.length,
    report,
  })
}
