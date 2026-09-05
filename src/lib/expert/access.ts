// src/lib/expert/access.ts
//
// Accès experts (page publique /expert, QR A4 à l'accueil). Olivier 2026-09-05.
//
//   - La CLÉ D'APPAREIL identifie l'expert (prénom) ; ses bureaux sont une
//     liste, chacun validé une fois par le bureau fourrière.
//   - Validation = popup BLOQUANT chez les comptes du bureau fourrière (module
//     « fourriere ») ; le PREMIER qui répond décide et ferme le popup chez
//     les autres (toutes les notifications du même request_id sont marquées
//     répondues).
//   - Un expert validé cherche une plaque : uniquement les fiches
//     Police – Accident EN PARC ; il reçoit la zone + les photos d'entrée ;
//     « Véhicule vu » enregistre la visite (registre) → arme le contrôle de sortie.

import { randomBytes, randomUUID } from 'crypto'
import { sendNotification } from '@/lib/notifications/send'
import { normalizePlate } from '@/lib/plate'
import { armExitControlFromVisit } from '@/lib/missions/exit-control'

export const EXPERT_SOURCES = ['police_accident']

export function newDeviceKey(): string {
  return randomBytes(24).toString('hex')
}

/** Comptes du bureau fourrière : module « fourriere » accordé, actifs ; repli superadmin. */
export async function officeUserIds(sb: any): Promise<string[]> {
  const { data: mods } = await sb.from('user_modules').select('user_id').eq('module_id', 'fourriere').eq('granted', true)
  const ids = Array.from(new Set((mods || []).map((m: any) => m.user_id).filter(Boolean))) as string[]
  if (ids.length) {
    const { data: users } = await sb.from('users').select('id').in('id', ids).eq('active', true)
    const active = (users || []).map((u: any) => u.id)
    if (active.length) return active
  }
  const { data: admins } = await sb.from('users').select('id').eq('active', true).or('role.eq.superadmin,roles.cs.{superadmin}')
  return (admins || []).map((u: any) => u.id)
}

export async function loadDevice(sb: any, key: string) {
  if (!key || key.length < 20) return null
  const { data } = await sb.from('expert_devices').select('*').eq('device_key', key).is('revoked_at', null).maybeSingle()
  if (!data) return null
  await sb.from('expert_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id)
  return data
}

export async function deviceBureaus(sb: any, deviceId: string) {
  const { data } = await sb.from('expert_device_bureaus').select('id, bureau, status, requested_at, decided_at')
    .eq('device_id', deviceId).order('requested_at', { ascending: true })
  return data || []
}

/**
 * Demande d'accès pour un ou plusieurs bureaux → lignes pending + UN SEUL popup
 * bloquant au bureau fourrière (une décision par bureau, le premier qui
 * répond décide pour tous, le popup se ferme chez les autres).
 */
export async function requestBureauAccess(sb: any, device: any, bureaus: string[]): Promise<{ id: string; bureau: string; status: string }[]> {
  const wanted = Array.from(new Set(bureaus.map(b => String(b || '').trim()).filter(Boolean)))
  const rows: { id: string; bureau: string; status: string }[] = []
  const now = new Date().toISOString()
  for (const bureau of wanted) {
    const { data: existing } = await sb.from('expert_device_bureaus').select('id, bureau, status')
      .eq('device_id', device.id).eq('bureau', bureau).maybeSingle()
    if (existing && existing.status === 'approved') { rows.push(existing); continue }
    if (!existing) {
      const r = await sb.from('expert_device_bureaus').insert({ device_id: device.id, bureau, status: 'pending' }).select('id, bureau, status').single()
      if (r.data) rows.push(r.data)
    } else {
      if (existing.status !== 'pending') {
        await sb.from('expert_device_bureaus').update({ status: 'pending', requested_at: now, decided_at: null, decided_by: null }).eq('id', existing.id)
      }
      rows.push({ ...existing, status: 'pending' })
    }
  }
  const pending = rows.filter(r => r.status === 'pending')
  if (!pending.length) return rows

  const { data: others } = await sb.from('expert_device_bureaus').select('bureau').eq('device_id', device.id).eq('status', 'approved')
  const already = (others || []).map((o: any) => o.bureau).filter((b: string) => !wanted.includes(b))
  const group = randomUUID()
  const list = pending.map(r => r.bureau).join(', ')
  for (const userId of await officeUserIds(sb)) {
    await sendNotification(userId, 'expert_access', {
      title: `Accès expert : ${device.first_name} — ${list}`,
      body: already.length
        ? `${device.first_name}, déjà validé pour ${already.join(', ')}, demande l'accès pour ${list}.`
        : `${device.first_name} scanne le QR experts pour la première fois et demande l'accès au parc pour ${list}.`,
      action_url: '/fourriere',
      data: {
        modal: true, kind: 'expert_access', request_group: group, device_id: device.id, first_name: device.first_name, already,
        items: pending.map(r => ({ request_id: r.id, bureau: r.bureau })),
      },
    })
  }
  return rows
}

/**
 * Décision du bureau (premier qui répond) : une décision par demande, puis
 * fermeture du popup chez tous les destinataires du même groupe.
 */
export async function decideBureauAccess(sb: any, group: string, decisions: Record<string, 'approve' | 'refuse'>, userId: string) {
  const now = new Date().toISOString()
  const results: { bureau: string; status: string }[] = []
  for (const [requestId, decision] of Object.entries(decisions)) {
    const { data: row } = await sb.from('expert_device_bureaus').select('id, bureau, status').eq('id', requestId).maybeSingle()
    if (!row) continue
    if (row.status === 'pending') {
      await sb.from('expert_device_bureaus').update({ status: decision === 'approve' ? 'approved' : 'refused', decided_at: now, decided_by: userId }).eq('id', row.id)
      results.push({ bureau: row.bureau, status: decision === 'approve' ? 'approved' : 'refused' })
    } else results.push({ bureau: row.bureau, status: row.status })
  }
  if (group) {
    await sb.from('notifications_log')
      .update({ responded_at: now, read_at: now })
      .eq('notif_type', 'expert_access')
      .is('responded_at', null)
      .eq('payload->data->>request_group', group)
  }
  return { ok: true, results }
}

/** Fiche Police – Accident en parc pour cette plaque (zone + photos), sinon null. */
export async function lookupParkedAccident(sb: any, plateRaw: string) {
  const plate = normalizePlate(plateRaw)
  if (plate.length < 3) return null
  const { data: rows } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, parc_zone_key, parked_at, driver_photos, source, status')
    .eq('status', 'parked').in('source', EXPERT_SOURCES)
    .order('parked_at', { ascending: false }).limit(500)
  const m = (rows || []).find((r: any) => normalizePlate(String(r.vehicle_plate || '')) === plate)
  if (!m) return null
  let zoneLabel = m.parc_zone_key || null
  if (m.parc_zone_key) {
    const { data: z } = await sb.from('parc_zones').select('label').eq('key', m.parc_zone_key).maybeSingle()
    if (z?.label) zoneLabel = z.label
  }
  return {
    id: m.id, mission_number: m.mission_number, plate: m.vehicle_plate, brand: m.vehicle_brand, model: m.vehicle_model,
    vin: m.vehicle_vin, zone: zoneLabel, parked_at: m.parked_at,
    photos: Array.isArray(m.driver_photos) ? m.driver_photos.filter((p: any) => typeof p === 'string').slice(0, 6) : [],
  }
}

/** « Véhicule vu » : visite au registre + contrôle de sortie + info au bureau. */
export async function recordExpertVisit(sb: any, device: any, bureau: string, missionId: string) {
  const { data: motif } = await sb.from('visitor_motifs').select('label').eq('is_expert', true).eq('active', true).order('sort_order').limit(1).maybeSingle()
  const motifLabel = motif?.label || 'Expertise'
  const now = new Date().toISOString()
  const { data: visit, error } = await sb.from('mission_visitors').insert({
    mission_id: missionId, visited_at: now, first_name: device.first_name, last_name: null,
    motifs: [motifLabel], expert_bureau: bureau, source: 'expert_qr', expert_device_id: device.id,
  }).select('id, visited_at, first_name, last_name, motifs, expert_bureau').single()
  if (error || !visit) throw new Error(error?.message || 'Visite non enregistrée')
  await sb.from('mission_logs').insert({
    mission_id: missionId, action: 'visitor',
    notes: `Visite expert (QR) : ${device.first_name} — ${motifLabel} (${bureau})`,
    metadata: { motifs: [motifLabel], expert_bureau: bureau, source: 'expert_qr', device_id: device.id },
  }).then(() => {}, () => {})
  await armExitControlFromVisit(sb, missionId, visit).catch(() => {})
  const { data: m } = await sb.from('incoming_missions').select('vehicle_plate, vehicle_brand, vehicle_model, parc_zone_key').eq('id', missionId).maybeSingle()
  for (const userId of await officeUserIds(sb)) {
    await sendNotification(userId, 'expert_visit', {
      title: `Expert au parc : ${m?.vehicle_plate || ''}`,
      body: `${device.first_name} (${bureau}) a vu le véhicule ${[m?.vehicle_brand, m?.vehicle_model].filter(Boolean).join(' ')} en zone ${m?.parc_zone_key || '?'}. Contrôle de sortie activé.`,
      action_url: `/dispatch/${missionId}`, mission_id: missionId,
      data: { kind: 'expert_visit', device_id: device.id, bureau },
    })
  }
  return visit
}

/** Liste « Mes véhicules » : les fiches vues depuis ce téléphone. */
export async function deviceVehicles(sb: any, deviceId: string) {
  const { data: visits } = await sb.from('mission_visitors')
    .select('id, mission_id, visited_at, expert_bureau')
    .eq('expert_device_id', deviceId).order('visited_at', { ascending: false }).limit(100)
  const ids = Array.from(new Set((visits || []).map((v: any) => v.mission_id)))
  if (!ids.length) return []
  const [{ data: missions }, { data: controls }, { data: zones }] = await Promise.all([
    sb.from('incoming_missions').select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, status, parc_zone_key, parked_at, released_at, completed_at, driver_photos').in('id', ids),
    sb.from('mission_exit_control').select('mission_id, path, path_destination, path_chosen_by_kind, path_chosen_by_name, attestation_signed_at, forced_at').in('mission_id', ids),
    sb.from('parc_zones').select('key, label'),
  ])
  const zl = new Map<string, string>((zones || []).map((z: any) => [z.key, z.label]))
  const cm = new Map<string, any>((controls || []).map((c: any) => [c.mission_id, c]))
  const seen = new Set<string>()
  const out: any[] = []
  for (const v of visits || []) {
    if (seen.has(v.mission_id)) continue
    seen.add(v.mission_id)
    const m = (missions || []).find((x: any) => x.id === v.mission_id)
    if (!m) continue
    const c = cm.get(m.id)
    out.push({
      id: m.id, mission_number: m.mission_number, plate: m.vehicle_plate, brand: m.vehicle_brand, model: m.vehicle_model, vin: m.vehicle_vin,
      status: m.status, in_parc: m.status === 'parked',
      zone: m.parc_zone_key ? (zl.get(m.parc_zone_key) || m.parc_zone_key) : null,
      parked_at: m.parked_at, left_at: m.released_at || m.completed_at || null,
      photos: Array.isArray(m.driver_photos) ? m.driver_photos.filter((p: any) => typeof p === 'string').slice(0, 6) : [],
      visited_at: v.visited_at, bureau: v.expert_bureau,
      exit: c ? { path: c.path, destination: c.path_destination, by_kind: c.path_chosen_by_kind, by_name: c.path_chosen_by_name, signed: !!c.attestation_signed_at, forced: !!c.forced_at } : null,
    })
  }
  return out
}
