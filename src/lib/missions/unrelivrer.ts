// src/lib/missions/unrelivrer.ts
//
// REMETTRE À RELIVRER (Olivier 14/10/2026, 2GWS379) : une relivraison créée et donnée à un
// chauffeur qui ne peut finalement pas prendre le véhicule. Rien n'est supprimé : la fiche de
// relivraison (avec ses numéros d'assistance, VAB, COMEX…) retourne EN RÉSERVE sur le dossier,
// comme avant le clic « Relivrer » ; le véhicule reste au parc dans « À relivrer » et le bureau
// la recrée pour quelqu'un d'autre plus tard. Refusé si le véhicule a déjà été chargé.
import type { createAdminClient } from '@/lib/supabase'

type Sb = ReturnType<typeof createAdminClient>
const DONE = ['completed', 'to_invoice', 'invoiced', 'cancelled', 'ignored', 'deleted']

export async function remettreARelivrer(sb: Sb, relId: string, actor: { id: string; name: string }, motif: string): Promise<{ driver: string | null }> {
  const { data: rel } = await sb.from('incoming_missions').select('id, mission_number, status, mission_type, incident_type, parent_mission_id, assigned_to, loaded_at, dossier_leg, vehicle_plate').eq('id', relId).maybeSingle()
  if (!rel) throw new Error('Relivraison introuvable.')
  if (rel.dossier_leg || !/rel/i.test(`${rel.mission_type} ${rel.incident_type}`)) throw new Error('Cette fiche n’est pas une relivraison.')
  if (!rel.parent_mission_id) throw new Error('Relivraison sans dossier principal : à traiter à la main.')
  if (DONE.includes(String(rel.status))) throw new Error(`La relivraison est déjà ${rel.status} : rien à remettre.`)
  if (rel.loaded_at) throw new Error('Le véhicule a déjà été chargé sur cette relivraison : on ne la remet pas en attente.')
  const { data: parent } = await sb.from('incoming_missions').select('id, mission_number, status').eq('id', rel.parent_mission_id).maybeSingle()
  if (!parent || parent.status !== 'parked') throw new Error('Le véhicule n’est plus au parc sur le dossier principal : à traiter à la main.')
  const now = new Date().toISOString()
  const { error } = await sb.from('incoming_missions').update({
    status: 'ignored', assigned_to: null, assigned_at: null, accepted_at: null, on_way_at: null, on_site_at: null, truck_id: null, updated_at: now,
  }).eq('id', rel.id).eq('status', rel.status)
  if (error) throw new Error(error.message)
  let driver: string | null = null
  if (rel.assigned_to) {
    const { data: u } = await sb.from('users').select('name').eq('id', rel.assigned_to).maybeSingle()
    driver = u?.name || null
    const { sendNotification } = await import('@/lib/notifications/send')
    await sendNotification(rel.assigned_to, 'mission_retiree', {
      title: `Relivraison retirée — ${rel.vehicle_plate || ''}`,
      body: `Le bureau a retiré la relivraison #${rel.mission_number ?? ''} : tu ne dois plus la faire.`,
      mission_id: rel.id, action_url: '/mission',
    }).catch(() => {})
  }
  await sb.from('mission_logs').insert([
    { mission_id: rel.id, actor_id: actor.id, action: 'rel_unassigned_reserve', notes: `${actor.name} : relivraison retirée${driver ? ` à ${driver}` : ''} et remise en réserve sur le dossier #${parent.mission_number ?? ''} (à relivrer plus tard) — ${motif}`, metadata: { driver } },
    { mission_id: parent.id, actor_id: actor.id, action: 'rel_unassigned_reserve', notes: `Relivraison #${rel.mission_number ?? ''} remise en attente${driver ? ` (retirée à ${driver})` : ''} : le véhicule reste au parc, à relivrer — ${motif}`, metadata: { rel_id: rel.id, driver } },
  ]).then(() => {}, () => {})
  return { driver }
}

/**
 * RATTACHER UNE COMMANDE COMME RELIVRAISON D'UN DOSSIER (Olivier 14/10/2026, 2CNZ592) : une
 * assistance commande le transport d'une voiture que nous avons déjà remorquée. Ce n'est pas
 * un doublon : la commande devient la relivraison du dossier, avec SES numéros d'assistance
 * (la clôture part chez l'assistance par elle). Jamais de fusion.
 *  - véhicule au parc sur le dossier → même mise en réserve que l'arrivée automatique
 *    (reserveTowForParkedVehicle) : elle sera recréée depuis « À relivrer » ;
 *  - sinon → elle devient l'étape relivraison active du dossier, à attribuer.
 */
export async function rattacherRelivraison(sb: Sb, missionId: string, dossierId: string, actor: { id: string; name: string }): Promise<{ mode: 'reserve' | 'active'; dossier: number | null }> {
  const plateKey = (p?: string | null) => String(p || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const [{ data: m }, { data: d0 }] = await Promise.all([
    sb.from('incoming_missions').select('id, mission_number, status, vehicle_plate, dossier_leg, parent_mission_id, loaded_at, assigned_to').eq('id', missionId).maybeSingle(),
    sb.from('incoming_missions').select('id, mission_number, status, vehicle_plate, parent_mission_id, dossier_leg').eq('id', dossierId).maybeSingle(),
  ])
  if (!m) throw new Error('Commande introuvable.')
  if (!d0) throw new Error('Dossier introuvable.')
  // Toujours la fiche RACINE du dossier.
  let d: any = d0
  if (d0.parent_mission_id) { const { data: root } = await sb.from('incoming_missions').select('id, mission_number, status, vehicle_plate, parent_mission_id, dossier_leg').eq('id', d0.parent_mission_id).maybeSingle(); if (root) d = root }
  if (m.id === d.id) throw new Error('C’est la même fiche.')
  if (m.dossier_leg || m.parent_mission_id) throw new Error('Cette commande fait déjà partie d’un dossier.')
  if (!['new', 'dispatching', 'assigned', 'accepted'].includes(String(m.status)) || m.loaded_at) throw new Error(`La commande est déjà ${m.status}${m.loaded_at ? ' (chargée)' : ''} : on ne la rattache plus.`)
  if (['cancelled', 'ignored', 'deleted'].includes(String(d.status))) throw new Error('Le dossier est annulé.')
  if (!plateKey(m.vehicle_plate) || plateKey(m.vehicle_plate) !== plateKey(d.vehicle_plate)) throw new Error('Les deux fiches n’ont pas la même plaque : rattachement refusé.')
  const now = new Date().toISOString()
  if (m.assigned_to) await sb.from('incoming_missions').update({ status: 'dispatching', assigned_to: null, assigned_at: null, accepted_at: null, truck_id: null, updated_at: now }).eq('id', m.id)
  if (d.status === 'parked') {
    const { reserveTowForParkedVehicle } = await import('./reserve-rel')
    const r = await reserveTowForParkedVehicle({ sb, missionId: m.id, actorId: actor.id, actorName: `${actor.name} via Max`, parentId: d.id })
    if (!r.reserved) throw new Error(`Mise en réserve refusée : ${r.reason}.`)
    return { mode: 'reserve', dossier: d.mission_number }
  }
  const { error } = await sb.from('incoming_missions').update({ parent_mission_id: d.id, mission_type: 'REL', incident_type: 'relivraison', updated_at: now }).eq('id', m.id)
  if (error) throw new Error(error.message)
  await sb.from('mission_logs').insert([
    { mission_id: m.id, actor_id: actor.id, action: 'rel_attached', notes: `${actor.name} via Max : commande rattachée comme relivraison du dossier #${d.mission_number ?? ''} (lien d'assistance gardé, clôture par cette fiche). À attribuer.`, metadata: { parent_mission_id: d.id } },
    { mission_id: d.id, actor_id: actor.id, action: 'rel_attached', notes: `Relivraison #${m.mission_number ?? ''} rattachée au dossier par ${actor.name} via Max (commande de l'assistance, à attribuer).`, metadata: { rel_id: m.id } },
  ]).then(() => {}, () => {})
  return { mode: 'active', dossier: d.mission_number }
}
