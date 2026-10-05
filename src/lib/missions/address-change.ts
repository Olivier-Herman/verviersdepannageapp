// src/lib/missions/address-change.ts
//
// CHANGEMENT D'ADRESSE DE LIVRAISON REÇU EN COURS DE MISSION (Olivier 05/10/2026).
// 2DTV183 : Touring envoie une nouvelle commande « rem vers domicile » sur une REL déjà
// assignée ; VD Soft la rattache à la fiche sans regarder l'adresse, le mail n'est pas
// vu, et le véhicule est livré à l'ancienne adresse.
// Désormais : l'adresse n'est JAMAIS changée d'office.
//  - Le chauffeur reçoit un popup obligatoire « Adresse modifiée par l'assistance :
//    appelle le dispatch avant de livrer » + un bandeau sur sa fiche.
//  - Le dispatch (dispatchers + admin) reçoit un popup obligatoire : « Appliquer la
//    nouvelle adresse » ou « Garder l'adresse actuelle ». Le premier qui répond décide.
//  - Le chauffeur est prévenu de la décision.

import { sendNotification, sendNotificationToRoles } from '@/lib/notifications/send'

export interface NewAddress { address: string; name?: string | null; lat?: number | null; lng?: number | null }

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(rue|avenue|av|chaussee|place|boulevard|bd|route|chemin|belgique|belgium)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
/** Même adresse ? (même code postal + mêmes mots/numéros, à l'accent et la casse près) */
export function sameAddress(a?: string | null, b?: string | null): boolean {
  const x = norm(a || ''), y = norm(b || '')
  if (!x || !y) return true   // rien à comparer : on ne signale rien
  if (x === y) return true
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '))
  const small = tx.size <= ty.size ? tx : ty, big = small === tx ? ty : tx
  return [...small].every(t => big.has(t))
}

export const isAddressChangePending = (ac: any) => !!ac && !!ac.new_address && !ac.decided_at

/** Signale une nouvelle adresse de livraison reçue de l'assistance (sans rien modifier). */
export async function flagAddressChange(sb: any, missionId: string, next: NewAddress, origin: { source: string; ref?: string | null }): Promise<boolean> {
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, status, vehicle_plate, vehicle_brand, vehicle_model, destination_address, destination_name, assigned_to, address_change')
    .eq('id', missionId).maybeSingle()
  if (!m || !next.address) return false
  if (['completed', 'to_invoice', 'invoiced', 'cancelled', 'deleted', 'ignored'].includes(String(m.status))) return false
  if (sameAddress(m.destination_address, next.address)) return false
  if (isAddressChangePending(m.address_change) && sameAddress(m.address_change.new_address, next.address)) return false   // déjà signalé

  const now = new Date().toISOString()
  const group = `ac-${missionId}-${Date.now()}`
  const change = {
    new_address: next.address, new_name: next.name || null, new_lat: next.lat ?? null, new_lng: next.lng ?? null,
    old_address: m.destination_address || null, old_name: m.destination_name || null,
    source: origin.source, ref: origin.ref || null, detected_at: now, request_group: group,
  }
  await sb.from('incoming_missions').update({ address_change: change, updated_at: now }).eq('id', missionId)
  await sb.from('mission_logs').insert({
    mission_id: missionId, action: 'address_change_received',
    notes: `⚠️ ${origin.source} : nouvelle adresse de livraison reçue (${next.name ? next.name + ', ' : ''}${next.address}) — actuelle : ${m.destination_address || '—'}. En attente de la décision du dispatch.`,
    metadata: change,
  }).then(() => {}, () => {})

  const plate = m.vehicle_plate || 'sans plaque'
  let driverName: string | null = null
  if (m.assigned_to) {
    const { data: u } = await sb.from('users').select('name').eq('id', m.assigned_to).maybeSingle()
    driverName = u?.name || null
    await sendNotification(m.assigned_to, 'mission_address_changed', {
      title: `⚠️ Adresse modifiée — ${plate}`,
      body: `L'assistance a changé l'adresse de livraison. Ne livre pas : appelle le dispatch.`,
      mission_id: missionId, action_url: `/mission/${missionId}`,
      data: { modal: true, kind: 'address_change', role: 'driver', mission_id: missionId, mission_number: m.mission_number, plate, old_address: change.old_address, new_address: change.new_address, new_name: change.new_name, request_group: group },
    }).catch(() => {})
  }
  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'mission_address_changed', {
    title: `⚠️ Nouvelle adresse de livraison — ${plate}`,
    body: `${origin.source} a changé l'adresse de la fiche #${m.mission_number}. Appliquer la nouvelle adresse ou garder l'actuelle ?`,
    mission_id: missionId, action_url: `/dispatch/${missionId}`,
    data: {
      modal: true, kind: 'address_change', role: 'dispatch', request_group: group, mission_id: missionId, mission_number: m.mission_number,
      plate, vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null, driver_name: driverName, status: m.status,
      old_address: change.old_address, old_name: change.old_name, new_address: change.new_address, new_name: change.new_name, source: origin.source, ref: origin.ref || null,
    },
  }).catch(() => {})
  return true
}

/** Décision du dispatch : appliquer la nouvelle adresse ou garder l'actuelle. Le premier qui répond décide. */
export async function decideAddressChange(sb: any, notifId: string, userId: string, decision: 'apply' | 'keep'): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const { data: n } = await sb.from('notifications_log').select('id, notif_type, payload').eq('id', notifId).eq('user_id', userId).maybeSingle()
  const d = n?.payload?.data || {}
  if (!n || n.notif_type !== 'mission_address_changed' || d.role !== 'dispatch' || !d.mission_id) return { ok: false, error: 'Notification inconnue' }
  const now = new Date().toISOString()
  const closeGroup = async () => {
    if (d.request_group) await sb.from('notifications_log').update({ responded_at: now, read_at: now })
      .eq('notif_type', 'mission_address_changed').is('responded_at', null).eq('payload->data->>request_group', d.request_group).eq('payload->data->>role', 'dispatch')
    else await sb.from('notifications_log').update({ responded_at: now, read_at: now }).eq('id', notifId)
  }
  const { data: m } = await sb.from('incoming_missions').select('id, mission_number, vehicle_plate, assigned_to, destination_address, address_change').eq('id', d.mission_id).maybeSingle()
  if (!m) return { ok: false, error: 'Fiche introuvable' }
  const ac = m.address_change || {}
  if (!isAddressChangePending(ac) || (d.request_group && ac.request_group !== d.request_group)) { await closeGroup(); return { ok: true, already: true } }

  const { data: me } = await sb.from('users').select('name').eq('id', userId).maybeSingle()
  const upd: Record<string, any> = { address_change: { ...ac, decision, decided_at: now, decided_by: userId, decided_by_name: me?.name || null }, updated_at: now }
  if (decision === 'apply') {
    upd.destination_address = ac.new_address
    if (ac.new_name !== undefined) upd.destination_name = ac.new_name || null
    upd.destination_lat = ac.new_lat ?? null
    upd.destination_lng = ac.new_lng ?? null
  }
  const { error } = await sb.from('incoming_missions').update(upd).eq('id', m.id)
  if (error) return { ok: false, error: error.message }
  await sb.from('mission_logs').insert({
    mission_id: m.id, actor_id: userId, action: decision === 'apply' ? 'address_change_applied' : 'address_change_kept',
    notes: decision === 'apply' ? `Dispatch (${me?.name || '—'}) : nouvelle adresse de livraison appliquée — ${ac.new_address} (avant : ${ac.old_address || '—'}).` : `Dispatch (${me?.name || '—'}) : adresse de livraison inchangée — ${m.destination_address || '—'} (proposée : ${ac.new_address}).`,
  }).then(() => {}, () => {})
  await closeGroup()
  if (m.assigned_to) {
    await sendNotification(m.assigned_to, 'mission_address_changed', {
      title: decision === 'apply' ? `📍 Nouvelle adresse de livraison — ${m.vehicle_plate || ''}` : `📍 Adresse inchangée — ${m.vehicle_plate || ''}`,
      body: decision === 'apply' ? `Livre à : ${ac.new_name ? ac.new_name + ', ' : ''}${ac.new_address}` : `Le dispatch garde l'adresse : ${m.destination_address || '—'}`,
      mission_id: m.id, action_url: `/mission/${m.id}`,
      data: { kind: 'address_change', role: 'driver_decided', decision },
    }).catch(() => {})
  }
  return { ok: true }
}

/** Le chauffeur a lu l'alerte (il doit appeler le dispatch). */
export async function ackAddressChange(sb: any, notifId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: n } = await sb.from('notifications_log').select('id, notif_type, payload').eq('id', notifId).eq('user_id', userId).maybeSingle()
  const d = n?.payload?.data || {}
  if (!n || n.notif_type !== 'mission_address_changed' || d.role !== 'driver') return { ok: false, error: 'Notification inconnue' }
  const now = new Date().toISOString()
  await sb.from('notifications_log').update({ responded_at: now, read_at: now }).eq('id', notifId)
  const { data: m } = await sb.from('incoming_missions').select('address_change').eq('id', d.mission_id).maybeSingle()
  if (m?.address_change && m.address_change.request_group === d.request_group) {
    await sb.from('incoming_missions').update({ address_change: { ...m.address_change, driver_ack_at: now } }).eq('id', d.mission_id)
  }
  await sb.from('mission_logs').insert({ mission_id: d.mission_id, actor_id: userId, action: 'address_change_driver_ack', notes: 'Le chauffeur a lu l\'alerte de changement d\'adresse (doit appeler le dispatch).' }).then(() => {}, () => {})
  return { ok: true }
}
