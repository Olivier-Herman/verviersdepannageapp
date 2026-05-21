// src/app/api/inventaire/next-slot/route.ts
//
// GET /api/inventaire/next-slot?zone_key=X&row_number=Y
//
// Retourne le prochain slot disponible (= libre, non merge, non bloque) pour
// une rangee donnee. Permet a l inventaire de :
//   - reprendre proprement apres une session restauree (recalcul vs valeur figee)
//   - sauter automatiquement les slots merges (parc_slot_groups) et bloques
//     (parc_blocked_slots) pendant le scan sequentiel
//   - reset apres un "Vider zone" (tous les slots sont libres -> next_slot=1)
//
// Algo : pour chaque slot s = 1..capacity :
//   si s est dans parc_slot_groups (merge) -> skip
//   si s est dans parc_blocked_slots (bloque) -> skip
//   si une mission active occupe s -> skip
//   sinon -> next_slot = s, on break
// Si tous les slots sont pris -> next_slot = capacity + 1 (overflow signal)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PARKED_STATUSES = ['parked', 'delivering']

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
  const rowNum  = parseInt(searchParams.get('row_number') || '0', 10)
  if (!zoneKey || !Number.isInteger(rowNum) || rowNum <= 0) {
    return NextResponse.json({ error: 'zone_key + row_number requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Capacite de la rangee
  const { data: rowMeta } = await sb
    .from('parc_rows')
    .select('capacity')
    .eq('zone_key',   zoneKey)
    .eq('row_number', rowNum)
    .maybeSingle()
  const capacity = rowMeta?.capacity || 0
  if (capacity <= 0) {
    return NextResponse.json({ next_slot: 1, max_slot: 0, capacity: 0, note: 'Rangee sans capacite definie' })
  }

  // Slots merges (parc_slot_groups)
  const { data: merged } = await sb
    .from('parc_slot_groups')
    .select('slot_index')
    .eq('zone_key',   zoneKey)
    .eq('row_number', rowNum)
  const mergedSet = new Set<number>((merged || []).map((m: any) => Number(m.slot_index)))

  // Slots bloques (parc_blocked_slots)
  const { data: blocked } = await sb
    .from('parc_blocked_slots')
    .select('slot_index')
    .eq('zone_key',   zoneKey)
    .eq('row_number', rowNum)
  const blockedSet = new Set<number>((blocked || []).map((b: any) => Number(b.slot_index)))

  // Slots occupes par missions actives
  const { data: missions } = await sb
    .from('incoming_missions')
    .select('parc_slot_index, vehicle_plate')
    .eq('parc_zone_key', zoneKey)
    .eq('parc_row_number', rowNum)
    .in('status', PARKED_STATUSES)
    .not('parc_slot_index', 'is', null)
  const missionSlots = new Map<number, string | null>()
  for (const m of (missions || [])) {
    if (m.parc_slot_index != null) missionSlots.set(Number(m.parc_slot_index), m.vehicle_plate)
  }

  // Trouve le 1er slot libre
  let nextSlot = capacity + 1  // overflow par defaut si tout est pris
  const reasons: Array<{ slot: number; reason: string }> = []
  for (let s = 1; s <= capacity; s++) {
    if (mergedSet.has(s))        { reasons.push({ slot: s, reason: 'merged' });  continue }
    if (blockedSet.has(s))       { reasons.push({ slot: s, reason: 'blocked' }); continue }
    if (missionSlots.has(s))     { reasons.push({ slot: s, reason: `mission (${missionSlots.get(s) || '?'})` }); continue }
    nextSlot = s
    break
  }

  return NextResponse.json({
    zone_key:    zoneKey,
    row_number:  rowNum,
    capacity,
    next_slot:   nextSlot,
    max_slot:    capacity,
    overflow:    nextSlot > capacity,
    skipped:     reasons,
    occupied: {
      merged:  Array.from(mergedSet).sort((a, b) => a - b),
      blocked: Array.from(blockedSet).sort((a, b) => a - b),
      missions: Object.fromEntries(missionSlots),
    },
  })
}
