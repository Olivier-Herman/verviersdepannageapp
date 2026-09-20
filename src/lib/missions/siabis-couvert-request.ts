// src/lib/missions/siabis-couvert-request.ts
//
// PASSAGE EN SIABIS COUVERT SUR DEMANDE (Olivier 20/09/2026).
// Une fiche NON couverte ne repasse jamais en couvert par un simple clic
// chauffeur : « si le chauffeur la met en couvert alors qu'on n'a pas reçu le
// mail qui couvre les frais, on relivre en pensant facturer l'assistance, elle
// refuse, on perd ». Le chauffeur DEMANDE depuis la fiche ; tous les dispatchers
// (+ admin/superadmin) reçoivent un popup OBLIGATOIRE (data.modal, cf.
// verification_parc / expert_access) avec les fiches d'assistance connues pour
// la plaque ; le premier qui répond décide et ferme le popup chez les autres.
// Accepté → source sia_couvert (+ client facturé d'origine s'il existe) ;
// refusé → reste non couvert, le client paie. Le chauffeur est prévenu.

import { sendNotification, sendNotificationToRoles } from '@/lib/notifications/send'

const norm = (s: string) => String(s || '').replace(/[-.\s_/]/g, '').toUpperCase()

export async function requestSiabisCouvert(sb: any, missionId: string, driverId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, source, status, vehicle_plate, vehicle_brand, vehicle_model, incident_city, incident_address, assigned_to, origin_source, siabis_couvert_requested_at, siabis_couvert_decided_at')
    .eq('id', missionId).maybeSingle()
  if (!m) return { ok: false, error: 'Fiche introuvable' }
  if (m.source !== 'police_snc') return { ok: false, error: 'La fiche n\'est pas en Siabis non couvert' }
  const pending = m.siabis_couvert_requested_at && (!m.siabis_couvert_decided_at || m.siabis_couvert_decided_at < m.siabis_couvert_requested_at)
  if (pending) return { ok: false, error: 'Demande déjà envoyée au dispatch — en attente de réponse' }

  const { data: driver } = await sb.from('users').select('name').eq('id', driverId).maybeSingle()
  // Fiches d'assistance connues pour la même plaque (24 h) — l'indice du dispatch.
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data: same } = await sb.from('incoming_missions')
    .select('id, mission_number, source, status, vehicle_plate, received_at, assigned_to')
    .gte('received_at', since).neq('id', missionId).eq('dossier_leg', false).limit(200)
  const plate = norm(m.vehicle_plate || '')
  const candidates = (same || [])
    .filter((x: any) => plate && norm(x.vehicle_plate || '') === plate && !/^police_|^garage$|^unknown$/.test(String(x.source || '')))
    .map((x: any) => ({ mission_number: x.mission_number, source: x.source, status: x.status, received_at: x.received_at }))

  const now = new Date().toISOString()
  const group = `sc-${missionId}-${Date.now()}`
  await sb.from('incoming_missions').update({ siabis_couvert_requested_at: now, siabis_couvert_requested_by: driverId }).eq('id', missionId)
  await sb.from('mission_logs').insert({ mission_id: missionId, actor_id: driverId, action: 'siabis_couvert_requested', notes: 'Le chauffeur demande le passage en Siabis couvert (décision dispatch)' }).then(() => {}, () => {})

  const vehicle = [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'
  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'siabis_couvert_request', {
    title: `${driver?.name || 'Un chauffeur'} demande le passage en Siabis COUVERT — ${m.vehicle_plate || 'sans plaque'}`,
    body: `Fiche #${m.mission_number} · ${vehicle} · ${m.incident_city || m.incident_address || ''}. Une mission reçue d'une assistance couvre-t-elle ce véhicule ? Sans mission reçue, l'assistance refusera la facture.`,
    mission_id: missionId,
    action_url: `/dispatch/${missionId}`,
    data: {
      modal: true, kind: 'siabis_couvert', request_group: group, mission_id: missionId, mission_number: m.mission_number,
      plate: m.vehicle_plate, vehicle, city: m.incident_city || m.incident_address || null, driver_name: driver?.name || null,
      origin_source: m.origin_source || null, candidates,
    },
  })
  return { ok: true }
}

export async function decideSiabisCouvert(sb: any, notifId: string, userId: string, decision: 'approve' | 'refuse'): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const { data: n } = await sb.from('notifications_log').select('id, notif_type, payload, responded_at').eq('id', notifId).eq('user_id', userId).maybeSingle()
  const d = n?.payload?.data || {}
  if (!n || n.notif_type !== 'siabis_couvert_request' || !d.mission_id) return { ok: false, error: 'Notification inconnue' }
  const now = new Date().toISOString()
  // Le premier qui répond décide : verrou sur la fiche (decided_at plus récent que la demande).
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, source, assigned_to, origin_billed_to_id, origin_billed_to_name, billed_to_id, billed_to_name, snc_scenario, siabis_couvert_requested_at, siabis_couvert_decided_at')
    .eq('id', d.mission_id).maybeSingle()
  if (!m) return { ok: false, error: 'Fiche introuvable' }
  const alreadyDecided = m.siabis_couvert_decided_at && m.siabis_couvert_requested_at && m.siabis_couvert_decided_at >= m.siabis_couvert_requested_at
  if (alreadyDecided) {
    await sb.from('notifications_log').update({ responded_at: now, read_at: now }).eq('id', notifId)
    return { ok: true, already: true }
  }
  const upd: Record<string, unknown> = {
    siabis_couvert_decision: decision === 'approve' ? 'approved' : 'refused',
    siabis_couvert_decided_at: now, siabis_couvert_decided_by: userId, updated_at: now,
  }
  if (decision === 'approve' && m.source === 'police_snc') {
    upd.source = 'sia_couvert'
    upd.amount_to_collect = null                                  // couvert = jamais d'encaissement client
    if (m.snc_scenario === 'rem_client') upd.snc_scenario = 'rem_direct'
    if (!m.billed_to_id && m.origin_billed_to_id) { upd.billed_to_id = m.origin_billed_to_id; upd.billed_to_name = m.origin_billed_to_name }
  }
  const { error } = await sb.from('incoming_missions').update(upd).eq('id', m.id)
  if (error) return { ok: false, error: error.message }
  await sb.from('mission_logs').insert({
    mission_id: m.id, actor_id: userId, action: decision === 'approve' ? 'siabis_couvert_approved' : 'siabis_couvert_refused',
    notes: decision === 'approve' ? 'Dispatch : passage en Siabis couvert confirmé' : 'Dispatch : reste Siabis non couvert (aucune mission reçue de l\'assistance)',
  }).then(() => {}, () => {})
  // Ferme le popup chez tous les destinataires du même groupe.
  if (d.request_group) {
    await sb.from('notifications_log').update({ responded_at: now, read_at: now })
      .eq('notif_type', 'siabis_couvert_request').is('responded_at', null).eq('payload->data->>request_group', d.request_group)
  } else {
    await sb.from('notifications_log').update({ responded_at: now, read_at: now }).eq('id', notifId)
  }
  // Retour au chauffeur.
  if (m.assigned_to) {
    await sendNotification(m.assigned_to, 'siabis_couvert_decided', {
      title: decision === 'approve' ? `✅ Siabis COUVERT confirmé — #${m.mission_number}` : `⛔ Reste NON couvert — #${m.mission_number}`,
      body: decision === 'approve' ? 'Le dispatch confirme : facturé à l\'assistance, pas d\'encaissement client.' : 'Le dispatch n\'a aucune mission reçue de l\'assistance : le client paie sur place et se fait rembourser.',
      mission_id: m.id, action_url: `/mission/${m.id}`,
      data: { decision },
    }).catch(() => {})
  }
  return { ok: true }
}
