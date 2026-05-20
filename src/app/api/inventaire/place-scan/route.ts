// src/app/api/inventaire/place-scan/route.ts
//
// POST /api/inventaire/place-scan
// Body: { plaque?, ticket_id?, mission_num?, zone_key, row_number, slot_index }
//
// Place le vehicule scanne sur le plan visuel au slot specifie.
// - Resout incoming_missions par plaque (priorite) puis par external_id.
// - Strict capacity bypassed : pendant l inventaire, on accepte l overflow
//   (la voiture est physiquement la, peu importe la capacite enregistree).
// - Si le slot cible est marque bloque (parc_blocked_slots), REFUSE :
//   l inventaire ne doit pas ecraser un blocage explicite (panne sol etc).
// - Si la voiture etait deja placee ailleurs, capture l ancienne position
//   (transferred_from_*) pour la trace.
//
// Permissions : admin / superadmin / module fourriere.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// 'unlocated' inclus pour permettre la recovery automatique : si on rescan
// un vehicule perdu d une zone precedente, place-scan le retrouvera.
const PARKED_STATUSES = ['parked', 'delivering', 'unlocated']

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const plaque     = body.plaque     != null ? String(body.plaque).trim().toUpperCase() : ''
  const ticketId   = body.ticket_id  != null ? Number(body.ticket_id) : null
  const missionNum = body.mission_num != null ? String(body.mission_num).trim() : ''
  const zoneKey    = body.zone_key   != null ? String(body.zone_key).trim() : ''
  const rowNumber  = body.row_number != null ? Number(body.row_number) : NaN
  const slotIndex  = body.slot_index != null ? Number(body.slot_index) : NaN

  if (!zoneKey || !Number.isInteger(rowNumber) || rowNumber <= 0 ||
      !Number.isInteger(slotIndex) || slotIndex <= 0) {
    return NextResponse.json({ error: 'zone_key, row_number, slot_index requis' }, { status: 400 })
  }
  if (!plaque && !missionNum) {
    return NextResponse.json({ error: 'plaque ou mission_num requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // 1. Refuse si le slot cible est explicitement bloque.
  const { data: blocked } = await sb
    .from('parc_blocked_slots')
    .select('reason')
    .eq('zone_key',   zoneKey)
    .eq('row_number', rowNumber)
    .eq('slot_index', slotIndex)
    .maybeSingle()
  if (blocked) {
    const motif = blocked.reason ? ` (${blocked.reason})` : ''
    return NextResponse.json({
      error: `Emplacement ${zoneKey}${rowNumber}-${slotIndex} bloqué${motif}. Débloque-le sur /fourriere/plan avant d'inventorier.`,
    }, { status: 409 })
  }

  // 2. Resolution incoming_missions : plaque > external_id (= mission_num).
  let mission: any = null
  if (plaque) {
    const { data } = await sb
      .from('incoming_missions')
      .select('id, vehicle_plate, parc_zone_key, parc_row_number, parc_slot_index, status')
      .eq('vehicle_plate', plaque)
      .in('status', PARKED_STATUSES)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    mission = data
  }
  if (!mission && missionNum) {
    const { data } = await sb
      .from('incoming_missions')
      .select('id, vehicle_plate, parc_zone_key, parc_row_number, parc_slot_index, status')
      .eq('external_id', missionNum)
      .in('status', PARKED_STATUSES)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    mission = data
  }

  if (!mission) {
    // Pas dans incoming_missions VD Soft : c est un vehicule legacy Odoo-only.
    // Pas d erreur cote scan ; juste retour "not_in_vd_soft".
    return NextResponse.json({
      ok: true,
      placed: false,
      reason: 'not_in_vd_soft',
    })
  }

  // 3. Capture l ancien placement avant l update.
  const wasAt = mission.parc_zone_key ? {
    zone_key:   mission.parc_zone_key,
    row_number: mission.parc_row_number,
    slot_index: mission.parc_slot_index,
  } : null

  // 4. Gestion de l occupant actuel du slot (swap silencieux, comme dans /place).
  const { data: currentOccupant } = await sb
    .from('incoming_missions')
    .select('id, vehicle_plate')
    .eq('parc_zone_key', zoneKey)
    .eq('parc_row_number', rowNumber)
    .eq('parc_slot_index', slotIndex)
    .neq('id', mission.id)
    .maybeSingle()

  if (currentOccupant) {
    // L occupant prend la place qu avait la voiture qu on est en train de
    // scanner (qui peut etre null s elle n etait pas placee).
    await sb.from('incoming_missions').update({
      parc_zone_key:   wasAt?.zone_key   ?? null,
      parc_row_number: wasAt?.row_number ?? null,
      parc_slot_index: wasAt?.slot_index ?? null,
    }).eq('id', currentOccupant.id)
  }

  // 5. Update du placement de la voiture scannee.
  // Si le vehicule etait en status='unlocated' (perdu lors d un inventaire de
  // zone), on le rebascule en 'parked' + on clear unlocated_at/zone (recovery
  // automatique).
  const updates: Record<string, any> = {
    parc_zone_key:   zoneKey,
    parc_row_number: rowNumber,
    parc_slot_index: slotIndex,
  }
  if (mission.status === 'unlocated') {
    updates.status         = 'parked'
    updates.unlocated_at   = null
    updates.unlocated_zone = null
  }
  const { error: updErr } = await sb.from('incoming_missions').update(updates).eq('id', mission.id)
  if (updErr) {
    // Si les colonnes unlocated_* n existent pas encore en BDD, retry sans
    if (/unlocated_at|unlocated_zone/.test(updErr.message)) {
      const fallback = { ...updates }
      delete fallback.unlocated_at
      delete fallback.unlocated_zone
      await sb.from('incoming_missions').update(fallback).eq('id', mission.id)
    } else {
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }
  }

  // 6. Transfert detecte si zone OU rangee differente de l ancien placement.
  const transferred = wasAt && (
    wasAt.zone_key !== zoneKey ||
    wasAt.row_number !== rowNumber ||
    wasAt.slot_index !== slotIndex
  )

  return NextResponse.json({
    ok:          true,
    placed:      true,
    mission_id:  mission.id,
    was_at:      wasAt,
    transferred: Boolean(transferred),
    swapped_with: currentOccupant ? {
      mission_id: currentOccupant.id,
      plaque:     currentOccupant.vehicle_plate,
    } : null,
  })
}
