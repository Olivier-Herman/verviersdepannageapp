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
