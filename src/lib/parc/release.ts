// src/lib/parc/release.ts
//
// Helpers pour liberer une position parc et combler le trou en faisant reculer
// les voitures en aval (slot_index > oldSlot) vers le bas (slot_index - 1).
//
// Appele depuis :
//   - /api/parc/place           (drop vers sidebar / move vers autre rangee)
//   - /api/missions/invoice     (facturation -> mission completed -> sortie)
//   - /api/missions/no-charge   (non facture -> mission completed -> sortie)
//   - /api/inventaire/.../finish-zone  (vehicules unlocated dans la zone)

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shift les voitures en aval d une position liberee dans une rangee.
 * L appelant doit s assurer que la position (zone, row, slot) a deja ete liberee
 * en BDD avant d appeler (sinon collision UNIQUE).
 *
 * Decremente parc_slot_index de chaque voiture avec slot_index > oldSlot,
 * en ordre croissant pour eviter les collisions.
 */
export async function shiftAfterRelease(
  sb:      SupabaseClient,
  oldZone: string,
  oldRow:  number,
  oldSlot: number,
): Promise<number> {
  const { data: downstream } = await sb
    .from('incoming_missions')
    .select('id, parc_slot_index')
    .eq('parc_zone_key',   oldZone)
    .eq('parc_row_number', oldRow)
    .gt('parc_slot_index', oldSlot)
    .order('parc_slot_index', { ascending: true })

  if (!downstream || downstream.length === 0) return 0

  for (const m of downstream) {
    await sb.from('incoming_missions').update({
      parc_slot_index: (m.parc_slot_index as number) - 1,
    }).eq('id', m.id)
  }
  console.log(`[parc] Shift ${downstream.length} véhicule(s) en ${oldZone}${oldRow} apres liberation du slot ${oldSlot}`)
  return downstream.length
}

/**
 * Convenience : libere completement une mission du parc (clear zone+row+slot)
 * et shifte les voitures en aval. Utilise pour facturation / no-charge.
 * Pas d effet si la mission n etait pas placee.
 */
export async function releaseParcAndShift(
  sb:        SupabaseClient,
  missionId: string,
): Promise<{ shifted: number; was_at: { zone: string; row: number; slot: number } | null }> {
  const { data: prev } = await sb
    .from('incoming_missions')
    .select('parc_zone_key, parc_row_number, parc_slot_index')
    .eq('id', missionId)
    .maybeSingle()

  if (!prev || !prev.parc_zone_key || !prev.parc_row_number || !prev.parc_slot_index) {
    return { shifted: 0, was_at: null }
  }

  await sb
    .from('incoming_missions')
    .update({ parc_zone_key: null, parc_row_number: null, parc_slot_index: null })
    .eq('id', missionId)

  const shifted = await shiftAfterRelease(sb, prev.parc_zone_key, prev.parc_row_number, prev.parc_slot_index)
  return {
    shifted,
    was_at: { zone: prev.parc_zone_key, row: prev.parc_row_number, slot: prev.parc_slot_index },
  }
}
