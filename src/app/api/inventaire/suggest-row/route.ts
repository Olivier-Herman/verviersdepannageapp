// src/app/api/inventaire/suggest-row/route.ts
//
// GET /api/inventaire/suggest-row?zone_key=X
//
// Retourne la liste des rangees d une zone avec :
//   - capacite totale
//   - nombre d emplacements pris (missions + merges + bloques)
//   - 1er slot libre (= next_slot) - skip merges/bloques/occupes
//   - isFull boolean
//
// + une suggestion : 1ere rangee non-pleine avec son next_slot.
//
// Utilise pour le bouton "Transferer vers zone X" sur /v/[id] : au lieu de
// juste assigner la zone, le systeme propose directement la rangee + slot
// disponibles. L operateur valide ou change manuellement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PARKED_STATUSES = ['parked', 'delivering']

interface RowAvailability {
  row_number:  number
  sort_order:  number
  capacity:    number
  next_slot:   number       // 1er slot dispo (> capacity = rangee pleine)
  is_full:     boolean
  used_count:  number       // nb slots pris (missions + merges + bloques)
  occupants: {
    merged_slots:  number[]
    blocked_slots: number[]
    mission_slots: number[]
  }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const zoneKey = (searchParams.get('zone_key') || '').trim()
  if (!zoneKey) return NextResponse.json({ error: 'zone_key requis' }, { status: 400 })

  const sb = createAdminClient()

  // Recupere les rangees de la zone
  const { data: rows, error: rowsErr } = await sb
    .from('parc_rows')
    .select('row_number, capacity, sort_order')
    .eq('zone_key', zoneKey)
    .order('sort_order')
    .order('row_number')
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 })

  if (!rows || rows.length === 0) {
    return NextResponse.json({
      zone_key:   zoneKey,
      rows:       [],
      suggestion: null,
      message:    `Aucune rangee configuree pour la zone ${zoneKey}`,
    })
  }

  // Merges, bloques, missions actives — en bulk pour la zone entiere
  const [mergedRes, blockedRes, missionsRes] = await Promise.all([
    sb.from('parc_slot_groups')
      .select('row_number, slot_index')
      .eq('zone_key', zoneKey),
    sb.from('parc_blocked_slots')
      .select('row_number, slot_index')
      .eq('zone_key', zoneKey),
    sb.from('incoming_missions')
      .select('parc_row_number, parc_slot_index')
      .eq('parc_zone_key', zoneKey)
      .in('status', PARKED_STATUSES)
      .not('parc_row_number', 'is', null)
      .not('parc_slot_index', 'is', null),
  ])

  // Index par row_number -> Set<slot>
  const mergedByRow = new Map<number, Set<number>>()
  for (const m of (mergedRes.data || [])) {
    const r = Number(m.row_number); const s = Number(m.slot_index)
    if (!mergedByRow.has(r)) mergedByRow.set(r, new Set())
    mergedByRow.get(r)!.add(s)
  }
  const blockedByRow = new Map<number, Set<number>>()
  for (const b of (blockedRes.data || [])) {
    const r = Number(b.row_number); const s = Number(b.slot_index)
    if (!blockedByRow.has(r)) blockedByRow.set(r, new Set())
    blockedByRow.get(r)!.add(s)
  }
  const missionByRow = new Map<number, Set<number>>()
  for (const m of (missionsRes.data || [])) {
    const r = Number(m.parc_row_number); const s = Number(m.parc_slot_index)
    if (!missionByRow.has(r)) missionByRow.set(r, new Set())
    missionByRow.get(r)!.add(s)
  }

  const availability: RowAvailability[] = rows.map((r: any) => {
    const cap     = Number(r.capacity) || 0
    const merged  = mergedByRow.get(r.row_number) || new Set<number>()
    const blocked = blockedByRow.get(r.row_number) || new Set<number>()
    const miss    = missionByRow.get(r.row_number) || new Set<number>()

    let next = cap + 1
    for (let s = 1; s <= cap; s++) {
      if (merged.has(s))  continue
      if (blocked.has(s)) continue
      if (miss.has(s))    continue
      next = s
      break
    }
    const usedCount = merged.size + blocked.size + miss.size

    return {
      row_number: Number(r.row_number),
      sort_order: Number(r.sort_order || r.row_number),
      capacity:   cap,
      next_slot:  next,
      is_full:    next > cap,
      used_count: usedCount,
      occupants: {
        merged_slots:  Array.from(merged).sort((a, b) => a - b),
        blocked_slots: Array.from(blocked).sort((a, b) => a - b),
        mission_slots: Array.from(miss).sort((a, b) => a - b),
      },
    }
  })

  // Suggestion : 1ere rangee non-pleine (sort_order asc)
  const suggestion = availability.find(r => !r.is_full) || null

  return NextResponse.json({
    zone_key: zoneKey,
    rows:     availability,
    suggestion: suggestion ? {
      row_number: suggestion.row_number,
      slot_index: suggestion.next_slot,
      label:      `${zoneKey}${suggestion.row_number}-${suggestion.next_slot}`,
    } : null,
  })
}
