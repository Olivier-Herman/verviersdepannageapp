// src/lib/missions/pause-transfer.ts
//
// PAUSE ET TRANSFERT D'UNE MISSION PAR LE CHAUFFEUR (Olivier 18/10/2026, maquette validée).
//
// Pause — « Je reviens plus tard » : la mission reste ouverte, le chrono s'arrête, le chauffeur
// redevient libre pour le dispatch ; rappel à l'heure prévue, relance 15 min après, puis alerte
// au dispatch. Rien n'est envoyé à l'assistance pendant la pause.
//
// Transfert — le chauffeur A, après avoir appelé le chauffeur B, lui propose sa mission. Elle ne
// passe à B qu'à son acceptation ; B repart de zéro (en route depuis sa position) ; les pointages
// de A restent dans l'historique. 5 min sans réponse : appel automatique à B.
// Tout est écrit dans l'historique de la fiche (mission_logs).
import type { createAdminClient } from '@/lib/supabase'

type Sb = ReturnType<typeof createAdminClient>
const ACTIVE = ['accepted', 'on_way', 'on_site', 'in_progress']
const fmt = (iso: string) => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

async function mission(sb: Sb, id: string) {
  const { data } = await sb.from('incoming_missions').select('id, mission_number, status, assigned_to, loaded_at, vehicle_plate, incident_city, paused_at, pause_until, pause_reason, pause_total_seconds, transfer_to, transfer_from, transfer_reason, transfer_requested_at').eq('id', id).maybeSingle()
  if (!data) throw new Error('Mission introuvable.')
  return data as any
}
async function userName(sb: Sb, id?: string | null) {
  if (!id) return null
  const { data } = await sb.from('users').select('name').eq('id', id).maybeSingle()
  return (data as any)?.name || null
}
const log = (sb: Sb, missionId: string, actorId: string | null, action: string, notes: string, metadata: any = {}) =>
  sb.from('mission_logs').insert({ mission_id: missionId, actor_id: actorId, action, notes, metadata }).then(() => {}, () => {})
async function syncLA(missionId: string, event?: 'update' | 'end') {
  try { const { pushMissionLiveActivity } = await import('@/lib/native/pushLiveActivity'); await Promise.race([pushMissionLiveActivity(missionId, event ? { event } : undefined), new Promise(r => setTimeout(r, 6000))]) } catch {}
}

// ── Pause ─────────────────────────────────────────────────────────────────────
export async function pauseMission(sb: Sb, missionId: string, actor: { id: string; name: string }, untilIso: string, reason?: string | null) {
  const m = await mission(sb, missionId)
  if (m.assigned_to !== actor.id) throw new Error('Cette mission n’est pas à toi.')
  if (!ACTIVE.includes(String(m.status))) throw new Error('On ne peut mettre en pause qu’une mission acceptée et en cours.')
  if (m.loaded_at) throw new Error('Le véhicule est chargé : pas de pause possible.')
  if (m.transfer_to) throw new Error('Un transfert est en attente : annule-le d’abord.')
  const until = new Date(untilIso)
  if (isNaN(until.getTime()) || until.getTime() < Date.now() - 60_000) throw new Error('Choisis une heure de retour dans le futur.')
  const now = new Date().toISOString()
  const first = !m.paused_at
  await sb.from('incoming_missions').update({ paused_at: m.paused_at || now, pause_until: until.toISOString(), pause_reason: reason || null, pause_reminded_at: null, pause_relance_at: null, updated_at: now }).eq('id', missionId)
  await log(sb, missionId, actor.id, first ? 'mission_paused' : 'mission_pause_moved', `${actor.name} · ${first ? 'mise en pause' : 'heure de retour changée'} — reprise prévue ${fmt(until.toISOString())}${reason ? ` (${reason})` : ''}`, { until: until.toISOString(), reason: reason || null })
  await syncLA(missionId)
  return { until: until.toISOString() }
}

export async function resumeMission(sb: Sb, missionId: string, actor: { id: string; name: string }, via: 'chauffeur' | 'rappel' = 'chauffeur') {
  const m = await mission(sb, missionId)
  if (m.assigned_to !== actor.id) throw new Error('Cette mission n’est pas à toi.')
  if (!m.paused_at) return { already: true }
  const now = new Date()
  const secs = Math.max(0, Math.round((now.getTime() - new Date(m.paused_at).getTime()) / 1000))
  await sb.from('incoming_missions').update({ paused_at: null, pause_until: null, pause_reason: null, pause_reminded_at: null, pause_relance_at: null, pause_total_seconds: (m.pause_total_seconds || 0) + secs, updated_at: now.toISOString() }).eq('id', missionId)
  await log(sb, missionId, actor.id, 'mission_resumed', `${actor.name} · reprise de la mission${via === 'rappel' ? ' (après le rappel)' : ''} — pause de ${Math.round(secs / 60)} min`, { pause_seconds: secs })
  await syncLA(missionId)
  return { resumed: true }
}

// ── Pause remise au dispatch (Olivier 29/10/2026, maquette validée) ────────────
// La mission quitte le chauffeur (statut 'dispatching', plus de chauffeur) mais reste marquée en pause : ligne orange
// au dispatch, liste « Missions en pause » pour tous les chauffeurs. Rien n'est envoyé à l'assistance.
export async function releaseToDispatch(sb: Sb, missionId: string, actor: { id: string; name: string }, untilIso: string, reason?: string | null) {
  const m = await mission(sb, missionId)
  if (m.assigned_to !== actor.id) throw new Error('Cette mission n’est pas à toi.')
  if (!ACTIVE.includes(String(m.status))) throw new Error('On ne peut remettre au dispatch qu’une mission acceptée et en cours.')
  if (m.loaded_at) throw new Error('Le véhicule est chargé : pas de pause possible.')
  if (m.transfer_to) throw new Error('Un transfert est en attente : annule-le d’abord.')
  const until = new Date(untilIso)
  if (isNaN(until.getTime()) || until.getTime() < Date.now() - 60_000) throw new Error('Choisis une heure de reprise dans le futur.')
  const now = new Date().toISOString()
  await syncLA(missionId, 'end')
  const { error } = await sb.from('incoming_missions').update({
    status: 'dispatching', assigned_to: null, assigned_at: null, truck_id: null, live_activity_push_token: null,
    paused_at: m.paused_at || now, pause_until: until.toISOString(), pause_reason: reason || null, pause_reminded_at: null, pause_relance_at: null,
    pause_released_at: now, pause_released_by: actor.id, pause_prev_status: m.status, updated_at: now,
  }).eq('id', missionId).eq('assigned_to', actor.id)
  if (error) throw new Error(error.message)
  await log(sb, missionId, actor.id, 'mission_pause_dispatch', `${actor.name} · remise au dispatch en pause — à reprendre dès ${fmt(until.toISOString())}${reason ? ` (${reason})` : ''}`, { until: until.toISOString(), reason: reason || null, prev_status: m.status })
  const { sendNotificationToRoles } = await import('@/lib/notifications/send')
  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'mission_pause_dispatch', {
    title: `⏸ ${m.vehicle_plate || 'Mission'} remise au dispatch par ${actor.name}`,
    body: `${reason ? reason + ' · ' : ''}${m.incident_city || ''} — à reprendre dès ${fmt(until.toISOString())}. Tout chauffeur peut la reprendre.`,
    mission_id: missionId, action_url: `/dispatch/${missionId}`,
  }).catch(() => {})
  return { until: until.toISOString() }
}

/** Un chauffeur reprend une mission remise au dispatch : elle repart chez lui depuis « acceptée » (en route depuis
 *  sa position) ; photos, notes et pointages du premier chauffeur restent dans l'historique. */
export async function takePausedMission(sb: Sb, missionId: string, actor: { id: string; name: string }) {
  const { data: m } = await sb.from('incoming_missions').select('id, vehicle_plate, incident_city, status, assigned_to, paused_at, pause_total_seconds, pause_released_at, pause_released_by').eq('id', missionId).maybeSingle()
  if (!m) throw new Error('Mission introuvable.')
  if (!(m as any).pause_released_at || (m as any).assigned_to) throw new Error('Cette mission a déjà été reprise.')
  const now = new Date()
  const secs = (m as any).paused_at ? Math.max(0, Math.round((now.getTime() - new Date((m as any).paused_at).getTime()) / 1000)) : 0
  const { data: b } = await sb.from('users').select('current_truck_id').eq('id', actor.id).maybeSingle()
  const { data: pris, error } = await sb.from('incoming_missions').update({
    assigned_to: actor.id, assigned_at: now.toISOString(), accepted_at: now.toISOString(), status: 'accepted',
    on_way_at: null, on_site_at: null, truck_id: (b as any)?.current_truck_id || null,
    paused_at: null, pause_until: null, pause_reason: null, pause_reminded_at: null, pause_relance_at: null,
    pause_total_seconds: ((m as any).pause_total_seconds || 0) + secs,
    pause_released_at: null, pause_released_by: null, pause_prev_status: null,
    accept_reminder_count: 0, accept_reminder_at: null, accept_call_at: null, updated_at: now.toISOString(),
  }).eq('id', missionId).is('assigned_to', null).not('pause_released_at', 'is', null).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  if (!pris) throw new Error('Cette mission a déjà été reprise.')
  const parQui = (await userName(sb, (m as any).pause_released_by)) || 'un chauffeur'
  await log(sb, missionId, actor.id, 'mission_pause_reprise', `${actor.name} · reprise de la mission remise au dispatch par ${parQui} — pause de ${Math.round(secs / 60)} min`, { pause_seconds: secs, released_by: (m as any).pause_released_by })
  const { sendNotificationToRoles } = await import('@/lib/notifications/send')
  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'mission_pause_reprise', {
    title: `▶️ ${(m as any).vehicle_plate || 'Mission'} reprise par ${actor.name}`,
    body: `Elle était en pause au dispatch (remise par ${parQui}).`, mission_id: missionId, action_url: `/dispatch/${missionId}`,
  }).catch(() => {})
  return { taken: true }
}

/** Le dispatch attribue lui-même une mission en pause : la pause est levée (la mission repart de zéro chez le nouveau chauffeur). */
export const PAUSE_LEVEE = { paused_at: null, pause_until: null, pause_reason: null, pause_reminded_at: null, pause_relance_at: null, pause_released_at: null, pause_released_by: null, pause_prev_status: null }

// ── Transfert ─────────────────────────────────────────────────────────────────
export async function requestTransfer(sb: Sb, missionId: string, actor: { id: string; name: string }, toUserId: string, reason: string, called: boolean) {
  if (!called) throw new Error('Appelle d’abord le chauffeur et confirme qu’il est d’accord.')
  const m = await mission(sb, missionId)
  if (m.assigned_to !== actor.id) throw new Error('Cette mission n’est pas à toi.')
  if (!['assigned', ...ACTIVE].includes(String(m.status))) throw new Error('Cette mission ne peut plus être transférée.')
  if (m.loaded_at) throw new Error('Le véhicule est chargé : pas de transfert possible.')
  if (toUserId === actor.id) throw new Error('Choisis un autre chauffeur.')
  const { data: to } = await sb.from('users').select('id, name, active').eq('id', toUserId).maybeSingle()
  if (!to || (to as any).active === false) throw new Error('Chauffeur introuvable.')
  const now = new Date().toISOString()
  await sb.from('incoming_missions').update({ transfer_to: toUserId, transfer_from: actor.id, transfer_reason: reason || null, transfer_requested_at: now, transfer_call_at: null, updated_at: now }).eq('id', missionId)
  await log(sb, missionId, actor.id, 'transfer_requested', `${actor.name} · transfert demandé à ${(to as any).name}${reason ? ` (${reason})` : ''} — appel confirmé`, { to: toUserId, reason: reason || null })
  const { sendNotification } = await import('@/lib/notifications/send')
  await sendNotification(toUserId, 'mission_transfert', {
    title: `🔁 ${actor.name} te transfère une mission`,
    body: `${reason ? reason + ' · ' : ''}${m.incident_city || ''} — ouvre VD Soft pour l’accepter ou la refuser.`,
    mission_id: missionId, action_url: '/mission',
  }).catch(() => {})
  return { to: (to as any).name }
}

export async function cancelTransfer(sb: Sb, missionId: string, actor: { id: string; name: string }, auto = false) {
  const m = await mission(sb, missionId)
  if (!m.transfer_to) return { already: true }
  if (!auto && m.assigned_to !== actor.id) throw new Error('Cette mission n’est pas à toi.')
  const toName = await userName(sb, m.transfer_to)
  await sb.from('incoming_missions').update({ transfer_to: null, transfer_from: null, transfer_reason: null, transfer_requested_at: null, transfer_call_at: null, updated_at: new Date().toISOString() }).eq('id', missionId)
  await log(sb, missionId, actor.id, 'transfer_cancelled', `${actor.name} · transfert à ${toName || '?'} annulé`, {})
  return { cancelled: true }
}

export async function respondTransfer(sb: Sb, missionId: string, actor: { id: string; name: string }, accept: boolean) {
  const m = await mission(sb, missionId)
  if (m.transfer_to !== actor.id) throw new Error('Ce transfert ne t’est pas (ou plus) destiné.')
  const fromId = m.transfer_from || m.assigned_to
  const fromName = (await userName(sb, fromId)) || 'le chauffeur'
  const now = new Date().toISOString()
  const { sendNotification } = await import('@/lib/notifications/send')
  if (!accept) {
    await sb.from('incoming_missions').update({ transfer_to: null, transfer_from: null, transfer_reason: null, transfer_requested_at: null, transfer_call_at: null, updated_at: now }).eq('id', missionId)
    await log(sb, missionId, actor.id, 'transfer_refused', `${actor.name} · transfert refusé — la mission reste à ${fromName}`, {})
    if (fromId) await sendNotification(fromId, 'mission_transfert_reponse', { title: `✗ ${actor.name} a refusé le transfert`, body: `La mission ${m.vehicle_plate || ''} reste à toi.`, mission_id: missionId, action_url: `/mission/${missionId}` }).catch(() => {})
    return { accepted: false }
  }
  if (m.loaded_at) throw new Error('Le véhicule a été chargé entre-temps : transfert impossible.')
  const { data: b } = await sb.from('users').select('current_truck_id').eq('id', actor.id).maybeSingle()
  // La carte d'écran verrouillé de A se ferme ; B repart de zéro (accepté → en route depuis sa position).
  await syncLA(missionId, 'end')
  const { error } = await sb.from('incoming_missions').update({
    assigned_to: actor.id, assigned_at: now, accepted_at: now, status: 'accepted',
    on_way_at: null, on_site_at: null, truck_id: (b as any)?.current_truck_id || null,
    paused_at: null, pause_until: null, pause_reason: null,
    transfer_to: null, transfer_from: null, transfer_reason: null, transfer_requested_at: null, transfer_call_at: null,
    live_activity_push_token: null, updated_at: now,
  }).eq('id', missionId).eq('transfer_to', actor.id)
  if (error) throw new Error(error.message)
  await log(sb, missionId, actor.id, 'transfer_accepted', `${actor.name} · transfert accepté — la mission passe de ${fromName} à ${actor.name}`, { from: fromId, to: actor.id })
  if (fromId) await sendNotification(fromId, 'mission_transfert_reponse', { title: `✓ ${actor.name} a repris ta mission`, body: `La mission ${m.vehicle_plate || ''} est maintenant à ${actor.name}. Tu es libre.`, mission_id: missionId, action_url: '/mission' }).catch(() => {})
  try { const { pushStartLiveActivity } = await import('@/lib/native/pushLiveActivity'); await Promise.race([pushStartLiveActivity(missionId, { silent: true }), new Promise(r => setTimeout(r, 6000))]) } catch {}
  return { accepted: true }
}

/** Transferts en attente destinés à ce chauffeur (écran de B). */
export async function incomingTransfers(sb: Sb, userId: string) {
  const { data } = await sb.from('incoming_missions').select('id, mission_number, mission_type, source, incident_city, transfer_from, transfer_reason, transfer_requested_at').eq('transfer_to', userId).order('transfer_requested_at', { ascending: true })
  const out = []
  for (const r of data || []) out.push({ ...r, from_name: await userName(sb, (r as any).transfer_from) })
  return out
}
