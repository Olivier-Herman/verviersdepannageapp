// src/lib/missions/rattacher-doublon.ts
//
// Un doublon n'est plus « ignoré » : il est RATTACHÉ à la fiche gardée (Olivier 22/10/2026, 2CKJ771 : Touring
// avait envoyé la relivraison sous un 2e dossier, 2026BE407550 ; la fiche annulée comme doublon emportait sa
// référence, et le contrôle des facturations Touring ne retrouvait plus rien).
// On garde la fiche annulée (jamais supprimée), on la relie à la fiche gardée (merged_into_mission_id : les alertes
// d'adresse, la recherche et le contrôle BKO suivent) et on ajoute sa référence de dossier à la fiche gardée.

const norm = (p: string | null | undefined) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export async function rattacherDoublon(sb: any, dupId: string, actor: { id?: string | null; name?: string | null }): Promise<{ keptId: string; keptNumber: number | null; reference: string | null } | null> {
  const { data: dup } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, dossier_number, external_id, received_at, parent_mission_id, dossier_leg').eq('id', dupId).maybeSingle()
  if (!dup || dup.dossier_leg || !norm(dup.vehicle_plate)) return null
  const at = new Date(dup.received_at || Date.now()).getTime()
  const { data: cands } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, dossier_number, received_at, status, parent_mission_id')
    .ilike('vehicle_plate', `%${norm(dup.vehicle_plate)}%`)
    .eq('dossier_leg', false).neq('id', dup.id).is('merged_into_mission_id', null)
    .not('status', 'in', '(cancelled,ignored)')
    .gte('received_at', new Date(at - 15 * 864e5).toISOString()).lte('received_at', new Date(at + 15 * 864e5).toISOString())
    .order('received_at', { ascending: true }).limit(10)
  const same = (cands || []).filter((c: any) => norm(c.vehicle_plate) === norm(dup.vehicle_plate))
  if (!same.length) return null
  // La fiche gardée = la racine du dossier (pas une relivraison enfant), la plus ancienne.
  const kept = same.find((c: any) => !c.parent_mission_id) || same[0]
  const ref = String(dup.dossier_number || '').trim() || null
  const now = new Date().toISOString()
  await sb.from('incoming_missions').update({ merged_into_mission_id: kept.id, updated_at: now }).eq('id', dup.id)
  const keptDoss = String(kept.dossier_number || '').trim()
  if (ref && !keptDoss.toUpperCase().includes(ref.toUpperCase())) {
    await sb.from('incoming_missions').update({ dossier_number: keptDoss ? `${keptDoss} / ${ref}` : ref, updated_at: now }).eq('id', kept.id)
  }
  const who = actor.name || 'le dispatch'
  await sb.from('mission_logs').insert([
    { mission_id: kept.id, actor_id: actor.id || null, action: 'note', notes: `Doublon #${dup.mission_number} rattaché à cette fiche${ref ? ` — référence ${ref} ajoutée` : ''} (par ${who}).`, metadata: { doublon_rattache: dup.id, reference: ref } },
    { mission_id: dup.id, actor_id: actor.id || null, action: 'note', notes: `Rattachée comme doublon à la fiche #${kept.mission_number}${ref ? ` (référence ${ref} reportée)` : ''}.`, metadata: { merged_into: kept.id } },
  ]).then(() => {}, () => {})
  return { keptId: kept.id, keptNumber: kept.mission_number ?? null, reference: ref }
}
