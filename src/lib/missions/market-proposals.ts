// src/lib/missions/market-proposals.ts
//
// Propositions de nuit Momo Market (Olivier 30/09/2026, suite de l'idée de Franck).
//
// Une mission LIBRE arrive la nuit, « Garde de nuit automatique » activée :
//  1. Le 1er départ reçoit TOUJOURS la proposition en premier, même en mission
//     (notif → /proposition/<id>). 2 min sans réponse → appel avec message vocal ;
//     2 min de plus → réserve. La réserve n'est jamais dérangée tant que le 1er
//     départ ne l'a pas renvoyée (Olivier 30/09/2026 soir).
//  2. « Je suis déjà en mission » → garde-fou : estimation de son arrivée
//     (lib/missions/busy-eta.ts, GPS en direct). Sans fiche (appel police) : « Tu en
//     as pour combien de temps ? ». Puis :
//       - ≤ 1 h      : « tu pourrais y être vers HH:MM, tu confirmes ? »
//       - > 1 h      : « J'appelle le client » (10 min pour dire OK / pas OK)
//       - impossible : « es-tu certain de ne pas pouvoir y être dans l'heure ? »
//     et partout « Rappelle-moi dans 15 min » (une seule fois) : la proposition lui
//     revient 15 min plus tard, la réserve n'est pas dérangée.
//  3. Réserve : proposition seulement si le 1er refuse ou ne répond pas (et si son
//     toggle de nuit est actif). Elle peut appeler le 1er et lui RENVOYER la
//     mission. 4 min sans réponse, ou « déjà en mission » → dispatcher de garde.
//  Le dispatcher de garde est informé des rappels, des passages à la réserve et
//  quand personne ne prend. Chaque étape est journalisée (market_proposal_events)
//  pour la page /admin/garde-nuit.
//
// Une mission attribuée par le dispatcher ne se refuse pas : jamais de proposition.
// Pendant une proposition, la mission reste prenable dans Momo Market par tout
// chauffeur ; dès qu'elle est prise (ou attribuée par le dispatch), la proposition
// est close, l'appel raccroché et le chauffeur sollicité prévenu tout de suite
// (onMissionTaken). Le cron /api/cron/market-proposals (chaque minute) gère les
// délais. Aucune fonction ne jette : une notif ratée ne casse jamais un import.

import { createAdminClient } from '@/lib/supabase'
import { sendNotification } from '@/lib/notifications/send'
import { getBusinessNumber } from '@/lib/settings/business'
import {
  gardeNight, nightDutyNow, reserveNotifOn, describeBusy, brusselsNow, hhmm,
  TYPE_LABEL, MARKET_STATUSES, BUSY_STATUSES, HIDDEN_SOURCES, type GardeNight,
} from '@/lib/missions/market-notify'
import type { Coord } from '@/lib/routing/ors'

const CALL_AFTER_MIN      = 2    // notif sans réponse → appel au 1er départ
const ESCALATE_AFTER_MIN  = 4    // … puis 2 min de plus → réserve
const RESERVE_TIMEOUT_MIN = 4    // réserve sans réponse → dispatcher
const CONFIRM_TIMEOUT_MIN = 3    // « déjà en mission » sans confirmer l'estimation → réserve
const CLIENT_CALL_MIN     = 10   // « J'appelle le client » : délai pour donner sa réponse
const SNOOZE_MIN          = 15   // « Rappelle-moi dans 15 min »
const MAX_SNOOZES         = 1    // Olivier 30/09/2026 : une seule fois
export const ETA_OK_MIN   = 60   // arrivée estimée ≤ 1 h : on lui demande de confirmer son refus

export const PROPOSAL_SOUND_PATH = '/sounds/nouvelle-mission.wav'

/**
 * Interrupteur « Garde de nuit automatique » (app_settings.market_proposals_actif,
 * TEXTE JSON) : { night: 'YYYY-MM-DD' | null, by, byName, at }. Le dispatcher de
 * garde (ou un superadmin) l'active depuis le tableau de bord quand il va dormir ;
 * il ne vaut que pour la nuit où il a été activé → retour à « désactivé » à la fin
 * de la nuit (8 h). Désactivé : simple info au 1er départ (et à la réserve s'il est
 * en mission). Le mode test fonctionne dans tous les cas. Olivier 30/09/2026.
 * (Ancien format : true = toujours actif.)
 */
export interface NightSwitch { on: boolean; night: string | null; by: string | null; byName: string | null; at: string | null; legacy?: boolean }

export async function readNightSwitch(sb: Sb, nightKey: string | null): Promise<NightSwitch> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'market_proposals_actif').maybeSingle()
  let v: any = null
  try { v = JSON.parse(String(data?.value ?? 'null')) } catch { v = null }
  if (v === true) return { on: true, night: nightKey, by: null, byName: null, at: null, legacy: true }
  const night = v && typeof v === 'object' ? (v.night || null) : null
  return { on: !!night && night === nightKey, night, by: v?.by || null, byName: v?.byName || null, at: v?.at || null }
}

async function proposalsEnabled(sb: Sb, nightKey: string): Promise<boolean> {
  return (await readNightSwitch(sb, nightKey)).on
}

type Sb = ReturnType<typeof createAdminClient>

interface Driver {
  id: string; name: string; phone: string | null; active: boolean
  manual_offline: boolean | null; notif_preferences: Record<string, unknown> | null; onLeave: boolean
}

interface MissionCtx {
  id: string; number: number | null; source: string
  type: string; vehicle: string; place: string
  info: string   // « #1234 · VAB · 1-ABC-123 · Dison » pour les notifs de suivi
}

// ── Lecture ────────────────────────────────────────────────────────────────

async function loadDrivers(sb: Sb, ids: (string | null)[]): Promise<Map<string, Driver>> {
  const list = [...new Set(ids.filter(Boolean) as string[])]
  const out = new Map<string, Driver>()
  if (!list.length) return out
  const todayBxl = brusselsNow().dateIso
  const [{ data: users }, { data: leaves }, { data: pers }] = await Promise.all([
    sb.from('users').select('id, name, phone, active, manual_offline, notif_preferences').in('id', list),
    sb.from('conge_requests').select('user_id').eq('status', 'approved')
      .lte('start_date', todayBxl).gte('end_date', todayBxl).in('user_id', list),
    sb.from('personnel').select('user_id, phone').in('user_id', list),
  ])
  const onLeave = new Set((leaves || []).map((l: any) => l.user_id))
  for (const u of (users || []) as any[]) {
    const persPhone = (pers || []).find((p: any) => p.user_id === u.id)?.phone || null
    out.set(u.id, { ...u, phone: u.phone || persPhone, onLeave: onLeave.has(u.id) })
  }
  return out
}

/** En service pour les notifs opérationnelles : actif, pas « Hors ligne », pas en congé, notifs chauffeur non coupées. */
function available(d: Driver | undefined | null): boolean {
  return !!d && d.active && d.manual_offline !== true && !d.onLeave && (d.notif_preferences || {}).role_driver !== false
}

async function missionCtx(sb: Sb, missionId: string): Promise<(MissionCtx & { status: string; assigned_to: string | null; received_at: string | null }) | null> {
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, status, assigned_to, source, received_at, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_city, incident_address, touring_missing_since')
    .eq('id', missionId).maybeSingle()
  if (!m) return null
  const source = (m.source || '').toUpperCase()
  // Absente de COMEX (Touring l'a retirée ou refusée) : plus proposable tant qu'elle n'y revient pas.
  const masked = !!m.touring_missing_since && ['new', 'dispatching'].includes(m.status)
  return {
    id: m.id, number: m.mission_number ?? null, source, status: masked ? 'masked' : m.status, assigned_to: m.assigned_to, received_at: m.received_at,
    type:    TYPE_LABEL[(m.mission_type || '').toLowerCase().trim()] || '📋 Mission',
    vehicle: [m.vehicle_brand, m.vehicle_model, m.vehicle_plate].filter(Boolean).join(' '),
    place:   m.incident_city || m.incident_address || '',
    info:    [m.mission_number ? `#${m.mission_number}` : null, source || null, m.vehicle_plate, m.incident_city].filter(Boolean).join(' · ') || 'Mission',
  }
}

/** Journal des étapes (page /admin/garde-nuit). Ne jette jamais. */
async function logEvent(sb: Sb, p: { id?: string | null; mission_id?: string | null; driver_id?: string | null }, kind: string, data?: Record<string, unknown>): Promise<void> {
  await sb.from('market_proposal_events').insert({ proposal_id: p.id || null, mission_id: p.mission_id || null, driver_id: p.driver_id || null, kind, data: data || null })
    .then(() => {}, () => {})
}

async function notifyDispatcher(sb: Sb, missionId: string, title: string, body: string): Promise<void> {
  const { data: duty } = await sb.from('dispatcher_on_duty').select('user_id').eq('id', 1).maybeSingle()
  if (!duty?.user_id) return
  await sendNotification(duty.user_id, 'market_proposal_update', { title, body, action_url: `/dispatch/${missionId}`, mission_id: missionId })
    .catch(e => console.error('[market-proposals] notif dispatcher échouée', e?.message))
}

// ── Création / passage à la réserve ────────────────────────────────────────

async function createProposal(sb: Sb, ctx: MissionCtx, driver: Driver, step: 'night_first' | 'reserve', reason: string | null, firstLine: string | null): Promise<boolean> {
  const { data: p, error } = await sb.from('market_proposals')
    .insert({ mission_id: ctx.id, driver_id: driver.id, step, reason })
    .select('id').single()
  if (error || !p) {
    // 23505 = une proposition est déjà ouverte pour cette mission (import rejoué, course) : rien à faire.
    if ((error as any)?.code !== '23505') console.error('[market-proposals] création échouée', error?.message)
    return false
  }
  await logEvent(sb, { id: p.id, mission_id: ctx.id, driver_id: driver.id }, 'proposed', { step, reason })
  await sendNotification(driver.id, 'market_proposal', {
    title:      `${ctx.type} — ${ctx.source} · mission proposée`,
    body:       [[ctx.vehicle, ctx.place].filter(Boolean).join(' — ') || 'Nouvelle mission', firstLine, 'Ouvre pour accepter ou dire que tu es déjà en mission.']
                  .filter(Boolean).join('\n'),
    action_url: `/proposition/${p.id}`,
    mission_id: ctx.id,
    data:       { proposal_id: p.id, step },
  }).catch(e => console.error('[market-proposals] notif proposition échouée', e?.message))
  return true
}

/** Passe la mission à la réserve (toggle actif) ou, à défaut, au dispatcher de garde. */
async function escalateToReserve(sb: Sb, ctx: MissionCtx, duty: GardeNight, reason: string, firstLine: string | null): Promise<void> {
  const reserveId = duty.reserve && duty.reserve !== duty.nightFirst ? duty.reserve : null
  const drivers   = await loadDrivers(sb, [reserveId])
  const reserve   = reserveId ? drivers.get(reserveId) : undefined
  if (reserve && available(reserve) && reserveNotifOn(reserve.notif_preferences, duty.nightKey)) {
    if (await createProposal(sb, ctx, reserve, 'reserve', reason, firstLine)) {
      await notifyDispatcher(sb, ctx.id, `➡️ Mission proposée à ${reserve.name} (réserve)`, `${ctx.info} — ${reason}`)
    }
    return
  }
  await logEvent(sb, { mission_id: ctx.id }, 'to_dispatcher', { reason })
  const why = !reserveId ? 'pas de réserve cette nuit'
    : !available(reserve) ? `${reserve?.name || 'la réserve'} (réserve) est hors ligne ou en congé`
    : `${reserve?.name || 'la réserve'} (réserve) a désactivé sa notif de nuit`
  await notifyDispatcher(sb, ctx.id, '⚠️ Mission libre à dispatcher', `${ctx.info} — ${reason} ; ${why}.`)
}

/**
 * Arrivée d'une mission : démarre le déroulé de nuit. Appelé par notifyMarketNewMission
 * (mail, création manuelle, VAB, Touring, Kaze, AXA). Hors nuit : ne fait rien.
 */
export async function startNightFlow(missionId: string): Promise<void> {
  try {
    const sb = createAdminClient()
    const duty = await nightDutyNow(sb)
    if (!duty?.nightFirst) return

    const ctx = await missionCtx(sb, missionId)
    if (!ctx || ctx.assigned_to || !MARKET_STATUSES.includes(ctx.status) || HIDDEN_SOURCES.includes(ctx.source.toLowerCase() || 'unknown')) return
    const freshMin = await getBusinessNumber('momo_market_fresh_minutes').catch(() => 45)
    if (ctx.received_at && Date.now() - new Date(ctx.received_at).getTime() > freshMin * 60_000) return

    // Une seule fois par mission (un import peut repasser plusieurs fois).
    const [{ data: prop }, { data: notif }] = await Promise.all([
      sb.from('market_proposals').select('id').eq('mission_id', missionId).limit(1),
      sb.from('notifications_log').select('id').eq('notif_type', 'market_new_mission').eq('payload->>mission_id', missionId).limit(1),
    ])
    if (prop?.length || notif?.length) return

    if (!(await proposalsEnabled(sb, duty.nightKey))) { await infoOnlyFlow(sb, ctx, duty); return }

    const drivers = await loadDrivers(sb, [duty.nightFirst])
    const first   = drivers.get(duty.nightFirst)
    if (!first || !available(first)) {
      await escalateToReserve(sb, ctx, duty, `${first?.name || 'Le 1er départ'} est hors ligne ou en congé`, null)
      return
    }
    // Toujours d'abord au 1er départ, même en mission (il peut enchaîner) ; la réserve
    // n'est pas dérangée.
    await createProposal(sb, ctx, first, 'night_first', null, null)
  } catch (e: any) {
    console.error('[market-proposals] démarrage échoué (non bloquant):', e?.message)
  }
}

/**
 * Mode « simple info » (propositions désactivées) : le 1er départ est prévenu de la
 * mission libre ; la réserve aussi si le 1er départ est en mission et si son
 * toggle de nuit est actif, avec où en est le 1er départ. Tap → Momo Market.
 */
async function infoOnlyFlow(sb: Sb, ctx: MissionCtx, duty: GardeNight): Promise<void> {
  const reserveId = duty.reserve && duty.reserve !== duty.nightFirst ? duty.reserve : null
  const drivers = await loadDrivers(sb, [duty.nightFirst, reserveId])
  const first   = duty.nightFirst ? drivers.get(duty.nightFirst) : undefined
  const reserve = reserveId ? drivers.get(reserveId) : undefined
  const base = {
    title:      `${ctx.type} — ${ctx.source} · Momo Market`,
    body:       [ctx.vehicle, ctx.place].filter(Boolean).join(' — ') || 'Nouvelle mission disponible',
    action_url: '/missions-dispo',
    mission_id: ctx.id,
  }
  if (first && available(first)) {
    await sendNotification(first.id, 'market_new_mission', { ...base, data: { role: 'night_first' } })
      .catch(e => console.error('[market-proposals] info 1er départ échouée', e?.message))
  }
  if (first && reserve && available(reserve) && reserveNotifOn(reserve.notif_preferences, duty.nightKey)) {
    const { data: missions } = await sb.from('incoming_missions')
      .select('status, on_way_at, on_site_at, loaded_at, incident_city, incident_address, destination_address')
      .eq('assigned_to', first.id).in('status', BUSY_STATUSES)
    if (missions?.length) {
      await sendNotification(reserve.id, 'market_new_mission', { ...base, body: `${base.body}\n${describeBusy(first.name, missions)}`, data: { role: 'reserve' } })
        .catch(e => console.error('[market-proposals] info réserve échouée', e?.message))
    }
  }
}

// ── Réponse du chauffeur ──────────────────────────────────────────────────

export async function closedMessage(sb: Sb, p: any): Promise<string> {
  if (p.is_test) {
    if (p.status === 'accepted') return '🧪 Test réussi : en vrai, la mission t’aurait été attribuée et sa fiche se serait ouverte.'
    if (p.status === 'busy')     return '🧪 Test réussi : en vrai, la mission partirait chez la réserve et le dispatch serait prévenu.'
    if (p.status === 'timeout')  return '🧪 Test terminé : en vrai, la mission serait maintenant proposée à la réserve.'
    return '🧪 Test fermé.'
  }
  if (p.status === 'accepted') return 'Tu as accepté cette mission.'
  if (p.closed_reason === 'client_ko') return 'Le client n’a pas accepté ton délai : la mission est passée à la suite.'
  if (p.status === 'busy')     return 'Tu as confirmé que tu ne pouvais pas la prendre : la mission est passée à la suite.'
  if (p.status === 'timeout')  return 'Délai dépassé : la mission a été passée à la suite.'
  if (p.closed_reason === 'returned') return 'Tu as renvoyé la mission au 1er départ.'
  if (p.closed_reason === 'claimed' || p.closed_reason === 'assigned') {
    const { data: u } = p.closed_by ? await sb.from('users').select('name').eq('id', p.closed_by).maybeSingle() : { data: null }
    return p.closed_reason === 'claimed' ? `${u?.name || 'Un autre chauffeur'} a pris la mission.` : `Mission attribuée à ${u?.name || 'un autre chauffeur'} par le dispatch.`
  }
  return 'Cette mission n’est plus disponible.'
}

export type ProposalAction = 'accept' | 'busy' | 'minutes' | 'confirm_busy' | 'snooze' | 'client_call' | 'client_ok' | 'client_ko' | 'return_first'

export interface RespondResult {
  ok: boolean; status: number; error?: string; missionId?: string
  /** Étape suivante à afficher sur la page (garde-fou, rappel, appel client…). */
  next?: { phase: string; etaMin?: number | null; arrivalAt?: string | null; steps?: string[]; reason?: string; gps?: string; snoozeUntil?: string; snoozesLeft?: number; clientPhone?: string | null }
}

const etaText = (etaMin: number | null | undefined, arrivalAt: string | null | undefined) =>
  etaMin != null && arrivalAt ? `arrivée estimée vers ${hhmm(arrivalAt)} (≈ ${etaMin} min)` : 'arrivée impossible à estimer'

async function hangUp(p: any) {
  if (p.call_id) { const { hangUpCall } = await import('@/lib/teams/call'); await hangUpCall(p.call_id) }
}

/** Ferme la proposition du 1er départ (refus confirmé) et passe à la réserve. */
async function firstRefuses(sb: Sb, p: any, name: string, reason: string, closedReason = 'busy'): Promise<boolean> {
  const { data: closed } = await sb.from('market_proposals')
    .update({ status: 'busy', responded_at: new Date().toISOString(), closed_reason: closedReason })
    .eq('id', p.id).eq('status', 'pending').select('id').maybeSingle()
  if (!closed) return false
  await hangUp(p)
  await logEvent(sb, p, closedReason === 'client_ko' ? 'client_ko' : 'refused', { reason })
  const ctx = await missionCtx(sb, p.mission_id)
  if (ctx && !ctx.assigned_to && MARKET_STATUSES.includes(ctx.status)) {
    const duty = await gardeNight(sb)
    if (duty) await escalateToReserve(sb, ctx, duty, reason, `👤 ${name} : ${reason.replace(new RegExp(`^${name}\\s*`), '')}`)
  }
  return true
}

export async function respondProposal(proposalId: string, userId: string, action: ProposalAction, extra: { minutes?: number; pos?: Coord | null } = {}): Promise<RespondResult> {
  const sb = createAdminClient()
  const { data: p } = await sb.from('market_proposals').select('*').eq('id', proposalId).maybeSingle()
  if (!p || p.driver_id !== userId) return { ok: false, status: 404, error: 'Proposition introuvable' }
  if (p.status !== 'pending') return { ok: false, status: 409, error: await closedMessage(sb, p) }
  const now = new Date().toISOString()

  if (p.is_test) {
    // Test : on enregistre la réponse, rien d'autre (aucune mission, ni réserve ni dispatch).
    await sb.from('market_proposals').update({ status: action === 'accept' ? 'accepted' : 'busy', responded_at: now, closed_reason: 'test' })
      .eq('id', p.id).eq('status', 'pending')
    await hangUp(p)
    return { ok: true, status: 200 }
  }

  const { data: me } = await sb.from('users').select('name').eq('id', userId).maybeSingle()
  const name = me?.name || 'Le chauffeur'

  // ── Accepter (proposition, ou client d'accord avec le délai) ──
  if (action === 'accept' || action === 'client_ok') {
    if (action === 'client_ok') await logEvent(sb, p, 'client_ok', {})
    const { claimMission } = await import('@/lib/missions/claim')
    const r = await claimMission(p.mission_id, userId, { via: 'proposal', freshMinutes: null })
    if (!r.ok) {
      // Prise ou retirée entre-temps : la proposition se ferme ; le cron préviendra au besoin.
      await sb.from('market_proposals').update({ status: 'cancelled', closed_reason: 'mission_gone' }).eq('id', p.id).eq('status', 'pending')
      return { ok: false, status: r.status, error: r.error }
    }
    await logEvent(sb, p, 'accepted', { phase: p.phase, eta_min: p.eta_min, snoozes: p.snooze_count, response_s: Math.round((Date.now() - new Date(p.notified_at).getTime()) / 1000) })
    return { ok: true, status: 200, missionId: p.mission_id }
  }

  // ── Réserve ──
  if (p.step === 'reserve') {
    if (action === 'busy') {
      const { data: closed } = await sb.from('market_proposals').update({ status: 'busy', responded_at: now, closed_reason: 'busy' })
        .eq('id', p.id).eq('status', 'pending').select('id').maybeSingle()
      if (!closed) return { ok: false, status: 409, error: 'Cette proposition vient d’être fermée.' }
      await logEvent(sb, p, 'refused', { step: 'reserve' })
      const ctx = await missionCtx(sb, p.mission_id)
      if (ctx && !ctx.assigned_to && MARKET_STATUSES.includes(ctx.status)) {
        await notifyDispatcher(sb, ctx.id, '⚠️ Mission libre à dispatcher', `${ctx.info} — ${name} (réserve) est aussi déjà en mission.`)
        await logEvent(sb, { mission_id: ctx.id }, 'to_dispatcher', { reason: 'réserve en mission' })
      }
      return { ok: true, status: 200, missionId: p.mission_id, next: { phase: 'closed' } }
    }
    if (action === 'return_first') {
      // La réserve a parlé au 1er départ : c'est faisable pour lui → on lui renvoie.
      const duty = await gardeNight(sb)
      const firstId = duty?.nightFirst
      if (!firstId || firstId === userId) return { ok: false, status: 400, error: 'Pas de 1er départ à qui renvoyer la mission.' }
      const ctx = await missionCtx(sb, p.mission_id)
      if (!ctx || ctx.assigned_to || !MARKET_STATUSES.includes(ctx.status)) return { ok: false, status: 409, error: 'Cette mission n’est plus disponible.' }
      const { data: closed } = await sb.from('market_proposals').update({ status: 'cancelled', responded_at: now, closed_reason: 'returned' })
        .eq('id', p.id).eq('status', 'pending').select('id').maybeSingle()
      if (!closed) return { ok: false, status: 409, error: 'Cette proposition vient d’être fermée.' }
      const first = (await loadDrivers(sb, [firstId])).get(firstId)
      if (!first) return { ok: false, status: 400, error: '1er départ introuvable.' }
      await createProposal(sb, ctx, first, 'night_first', `renvoyée par ${name} après discussion`, `↩️ ${name} (réserve) te la renvoie après en avoir parlé avec toi.`)
      await logEvent(sb, p, 'returned_to_first', { to: firstId })
      await notifyDispatcher(sb, ctx.id, `↩️ ${name} renvoie la mission à ${first.name}`, `${ctx.info} — après discussion entre eux.`)
      return { ok: true, status: 200, missionId: p.mission_id, next: { phase: 'closed' } }
    }
    return { ok: false, status: 400, error: 'Action impossible pour la réserve.' }
  }

  // ── 1er départ : « Je suis déjà en mission » → garde-fou ──
  if (action === 'busy' || action === 'minutes') {
    await hangUp(p)
    const { estimateArrival } = await import('@/lib/missions/busy-eta')
    if (action === 'busy') {
      const { data: fiche } = await sb.from('incoming_missions').select('id').eq('assigned_to', userId).in('status', BUSY_STATUSES).limit(1)
      await logEvent(sb, p, 'busy_declared', { has_fiche: !!fiche?.length })
      if (!fiche?.length) {
        // Pas de fiche (appel police…) : on lui demande combien de temps il en a.
        await sb.from('market_proposals').update({ phase: 'ask_minutes', phase_at: now }).eq('id', p.id).eq('status', 'pending')
        return { ok: true, status: 200, next: { phase: 'ask_minutes' } }
      }
    }
    const minutes = action === 'minutes' ? Math.max(0, Math.min(240, Number(extra.minutes) || 0)) : null
    if (extra.pos) {
      // Position en direct (il vient d'ouvrir l'app) : on la garde aussi pour la carte dispatch.
      await sb.from('users').update({ last_location_lat: extra.pos.lat, last_location_lng: extra.pos.lng, location_updated_at: now }).eq('id', userId)
    }
    const eta = await estimateArrival({ driverId: userId, newMissionId: p.mission_id, livePos: extra.pos || null, declaredMinutes: minutes })
    await sb.from('market_proposals').update({
      phase: 'confirm', phase_at: now, busy_minutes: minutes, eta_min: eta.etaMin,
      eta_detail: { steps: eta.steps, arrivalAt: eta.arrivalAt, reason: eta.reason || null, gps: eta.gps },
    }).eq('id', p.id).eq('status', 'pending')
    await logEvent(sb, p, 'eta', {
      eta_min: eta.etaMin, minutes, gps: eta.gps, reason: eta.reason || null,
      // Pour « annoncé contre réalité » : fin estimée de ce qu'il a en cours + ses fiches.
      finish_min: eta.finishMin ?? null, current_ids: eta.currentMissionIds || [],
    })
    return { ok: true, status: 200, next: { phase: 'confirm', etaMin: eta.etaMin, arrivalAt: eta.arrivalAt, steps: eta.steps, reason: eta.reason, gps: eta.gps, snoozesLeft: MAX_SNOOZES - (p.snooze_count || 0) } }
  }

  if (action === 'confirm_busy') {
    const ok = await firstRefuses(sb, p, name, `${name} ne peut pas la prendre (${etaText(p.eta_min, p.eta_detail?.arrivalAt)})`)
    return ok ? { ok: true, status: 200, next: { phase: 'closed' } } : { ok: false, status: 409, error: 'Cette proposition vient d’être fermée.' }
  }

  if (action === 'snooze') {
    if ((p.snooze_count || 0) >= MAX_SNOOZES) return { ok: false, status: 409, error: 'Tu as déjà demandé un rappel : accepte la mission ou confirme que tu ne peux pas.' }
    const until = new Date(Date.now() + SNOOZE_MIN * 60_000).toISOString()
    await sb.from('market_proposals').update({ phase: 'snoozed', phase_at: now, snooze_until: until, snooze_count: (p.snooze_count || 0) + 1 })
      .eq('id', p.id).eq('status', 'pending')
    await hangUp(p)
    await logEvent(sb, p, 'snoozed', { count: (p.snooze_count || 0) + 1, eta_min: p.eta_min })
    const ctx = await missionCtx(sb, p.mission_id)
    if (ctx) await notifyDispatcher(sb, ctx.id, `⏰ ${name} : rappel dans ${SNOOZE_MIN} min`, `${ctx.info} — ${etaText(p.eta_min, p.eta_detail?.arrivalAt)}. La réserve n'est pas dérangée pour l'instant.`)
    return { ok: true, status: 200, next: { phase: 'snoozed', snoozeUntil: until, snoozesLeft: MAX_SNOOZES - (p.snooze_count || 0) - 1 } }
  }

  if (action === 'client_call') {
    const { data: m } = await sb.from('incoming_missions').select('client_phone, assisted_phone').eq('id', p.mission_id).maybeSingle()
    const phone = m?.client_phone || m?.assisted_phone || null
    if (!phone) return { ok: false, status: 400, error: 'Pas de numéro de client sur la fiche.' }
    await sb.from('market_proposals').update({ phase: 'client_call', phase_at: now, client_call_at: now }).eq('id', p.id).eq('status', 'pending')
    await logEvent(sb, p, 'client_call', { eta_min: p.eta_min })
    return { ok: true, status: 200, next: { phase: 'client_call', clientPhone: phone } }
  }

  if (action === 'client_ko') {
    const ok = await firstRefuses(sb, p, name, `le client n'accepte pas le délai de ${name} (${etaText(p.eta_min, p.eta_detail?.arrivalAt)})`, 'client_ko')
    return ok ? { ok: true, status: 200, next: { phase: 'closed' } } : { ok: false, status: 409, error: 'Cette proposition vient d’être fermée.' }
  }

  return { ok: false, status: 400, error: 'Action inconnue.' }
}

// ── Mission prise ou attribuée ────────────────────────────────────────────

/**
 * La mission vient d'être prise (Momo Market, « J'accepte ») ou attribuée par le
 * dispatch : propositions ouvertes closes (le preneur → acceptée, les autres →
 * annulée), appel raccroché, et tout de suite « X a pris la mission » aux autres
 * chauffeurs prévenus + au dispatcher de garde (pas pour une attribution : c'est
 * lui qui l'a faite).
 */
export async function onMissionTaken(missionId: string, takerId: string, kind: 'claimed' | 'assigned'): Promise<void> {
  try {
    const sb = createAdminClient()
    const now = new Date().toISOString()
    const { data: open } = await sb.from('market_proposals').select('id, driver_id, call_id')
      .eq('mission_id', missionId).eq('status', 'pending')
    let viaProposal = false
    for (const p of (open || []) as any[]) {
      const mine = p.driver_id === takerId && kind === 'claimed'
      if (mine) viaProposal = true
      await sb.from('market_proposals').update({
        status: mine ? 'accepted' : 'cancelled', closed_reason: mine ? 'accepted' : kind, closed_by: takerId,
        ...(mine ? { responded_at: now } : {}),
      }).eq('id', p.id).eq('status', 'pending')
      if (p.call_id) { const { hangUpCall } = await import('@/lib/teams/call'); await hangUpCall(p.call_id) }
      if (!mine) await logEvent(sb, { id: p.id, mission_id: missionId, driver_id: p.driver_id }, kind === 'claimed' ? 'taken_by_other' : 'assigned_by_dispatch', { by: takerId })
    }
    if (!open?.length && kind === 'claimed') {
      // Prise dans Momo Market sans proposition ouverte (la nuit : utile aux statistiques).
      const { count } = await sb.from('market_proposals').select('id', { count: 'exact', head: true }).eq('mission_id', missionId)
      if (count) await logEvent(sb, { mission_id: missionId, driver_id: takerId }, 'claimed_in_market', {})
    }

    const [ctx, { data: taker }, { data: notified }, { data: duty }] = await Promise.all([
      missionCtx(sb, missionId),
      sb.from('users').select('name').eq('id', takerId).maybeSingle(),
      sb.from('notifications_log').select('user_id').in('notif_type', ['market_new_mission', 'market_proposal']).eq('payload->>mission_id', missionId),
      sb.from('dispatcher_on_duty').select('user_id').eq('id', 1).maybeSingle(),
    ])
    const who  = taker?.name || 'Un chauffeur'
    const info = ctx?.info || 'Mission'
    const drivers = [...new Set((notified || []).map((n: any) => n.user_id as string))].filter(id => id !== takerId)
    const sends = drivers.map(uid => sendNotification(uid, 'market_claimed', {
      title:      kind === 'claimed' ? `✅ ${who} a pris la mission` : `📌 Mission attribuée à ${who}`,
      body:       `${info} — plus rien à faire de ton côté`,
      action_url: '/missions-dispo',
      mission_id: missionId,
    }))
    if (kind === 'claimed' && duty?.user_id && duty.user_id !== takerId && !drivers.includes(duty.user_id)) {
      sends.push(sendNotification(duty.user_id, 'market_claimed', {
        title:      `🙋 ${who} a pris une mission`,
        body:       `${info} — ${viaProposal ? 'acceptée sur proposition de nuit' : 'prise dans Momo Market'}`,
        action_url: `/dispatch/${missionId}`,
        mission_id: missionId,
      }))
    }
    await Promise.allSettled(sends)
  } catch (e: any) {
    console.error('[market-proposals] onMissionTaken échoué (non bloquant):', e?.message)
  }
}

// ── Délais (cron chaque minute) ───────────────────────────────────────────

/** « 0478 12 34 56 » / « 0032478… » / « +32 478… » → « +32478123456 » ; null si inexploitable. */
export function toE164(raw: string | null | undefined): string | null {
  let s = (raw || '').replace(/[\s./()-]/g, '')
  if (!s) return null
  if (s.startsWith('00')) s = '+' + s.slice(2)
  else if (/^0\d{8,9}$/.test(s)) s = '+32' + s.slice(1)
  else if (/^32\d{8,9}$/.test(s)) s = '+' + s
  return /^\+\d{8,15}$/.test(s) ? s : null
}

async function startCall(sb: Sb, p: any, driver: Driver | undefined): Promise<void> {
  const phone = toE164(driver?.phone)
  const now = new Date().toISOString()
  if (!phone) {
    await sb.from('market_proposals').update({ call_at: now, call_error: 'Pas de numéro de téléphone exploitable' }).eq('id', p.id)
    return
  }
  const { initiatePstnCall } = await import('@/lib/teams/call')
  const r = await initiatePstnCall({ toPhone: phone, toDisplayName: driver?.name || phone })
  await sb.from('market_proposals').update({ call_at: now, call_id: r.callId || null, call_error: r.ok ? null : (r.error || 'Appel impossible') }).eq('id', p.id)
  if (!p.is_test) await logEvent(sb, p, 'called', { ok: r.ok, error: r.ok ? null : r.error })
}

export async function tickProposals(): Promise<{ checked: number; calls: number; escalated: number; closed: number }> {
  const sb = createAdminClient()
  const stats = { checked: 0, calls: 0, escalated: 0, closed: 0 }
  const { data: open, error } = await sb.from('market_proposals').select('*').eq('status', 'pending').order('notified_at')
  if (error) throw new Error(`Propositions illisibles : ${error.message}`)   // → alerte superadmins (cron)
  for (const p of (open || []) as any[]) {
    stats.checked++
    try {
      if (p.is_test) { await tickTest(sb, p, stats); continue }
      const ctx = await missionCtx(sb, p.mission_id)
      // Mission attribuée par le dispatch, prise hors de nos crochets, annulée…
      if (!ctx || ctx.assigned_to || !MARKET_STATUSES.includes(ctx.status)) {
        if (ctx?.assigned_to) await onMissionTaken(ctx.id, ctx.assigned_to, 'assigned')
        else {
          const { data: c } = await sb.from('market_proposals').update({ status: 'cancelled', closed_reason: 'mission_gone' })
            .eq('id', p.id).eq('status', 'pending').select('id').maybeSingle()
          if (c) {
            if (p.call_id) { const { hangUpCall } = await import('@/lib/teams/call'); await hangUpCall(p.call_id) }
            await sendNotification(p.driver_id, 'market_claimed', {
              title: '🚫 Mission plus disponible', body: `${ctx?.info || 'Mission'} — annulée ou retirée, plus rien à faire de ton côté`,
              action_url: '/missions-dispo', mission_id: p.mission_id,
            }).catch(() => {})
          }
        }
        stats.closed++
        continue
      }

      const ageMin = (Date.now() - new Date(p.phase_at || p.notified_at).getTime()) / 60_000
      const drivers = await loadDrivers(sb, [p.driver_id])
      const driver  = drivers.get(p.driver_id)
      const name    = driver?.name || 'Le chauffeur'
      const phase   = p.phase || 'asked'

      if (p.step === 'night_first') {
        if (phase === 'snoozed') {
          // « Rappelle-moi dans 15 min » écoulé : la proposition lui revient (notif, puis appel).
          if (p.snooze_until && Date.now() >= new Date(p.snooze_until).getTime()) {
            const now = new Date().toISOString()
            await sb.from('market_proposals').update({ phase: 'asked', phase_at: now, call_at: null, call_id: null, call_error: null })
              .eq('id', p.id).eq('status', 'pending')
            await sendNotification(p.driver_id, 'market_proposal', {
              title:      `⏰ Où en es-tu ? ${ctx.type} — ${ctx.source}`,
              body:       [[ctx.vehicle, ctx.place].filter(Boolean).join(' — ') || 'La mission', 'Elle t’attend toujours. Peux-tu la prendre ?'].join('\n'),
              action_url: `/proposition/${p.id}`,
              mission_id: ctx.id,
              data:       { proposal_id: p.id, step: p.step, reminder: true },
            }).catch(() => {})
            await logEvent(sb, p, 'reminded', { count: p.snooze_count })
          }
        } else if (phase === 'confirm' || phase === 'ask_minutes') {
          // Il a dit « déjà en mission » sans confirmer ni répondre : on passe à la réserve.
          if (ageMin >= CONFIRM_TIMEOUT_MIN) {
            if (await firstRefuses(sb, p, name, `${name} a répondu « déjà en mission » sans confirmer (${etaText(p.eta_min, p.eta_detail?.arrivalAt)})`)) stats.escalated++
          }
        } else if (phase === 'client_call') {
          if (ageMin >= CLIENT_CALL_MIN) {
            if (await firstRefuses(sb, p, name, `${name} n'a pas donné la réponse du client après ${CLIENT_CALL_MIN} min (${etaText(p.eta_min, p.eta_detail?.arrivalAt)})`)) stats.escalated++
          }
        } else if (ageMin >= ESCALATE_AFTER_MIN) {
          const { data: c } = await sb.from('market_proposals').update({ status: 'timeout', closed_reason: 'timeout' })
            .eq('id', p.id).eq('status', 'pending').select('id').maybeSingle()
          if (!c) continue
          await hangUp(p)
          await logEvent(sb, p, 'timeout', { called: !!p.call_id, call_error: p.call_error || null })
          const duty = await gardeNight(sb)
          const called = p.call_id ? 'notif + appel' : p.call_error ? `notif, appel impossible : ${p.call_error.toLowerCase()}` : 'notif'
          if (duty) await escalateToReserve(sb, ctx, duty, `${name} n'a pas répondu (${called})`, `👤 ${name} : pas de réponse`)
          stats.escalated++
        } else if (ageMin >= CALL_AFTER_MIN && !p.call_at) {
          await startCall(sb, p, driver)
          stats.calls++
        }
      } else if (ageMin >= RESERVE_TIMEOUT_MIN) {
        const { data: c } = await sb.from('market_proposals').update({ status: 'timeout', closed_reason: 'timeout' })
          .eq('id', p.id).eq('status', 'pending').select('id').maybeSingle()
        if (!c) continue
        await logEvent(sb, p, 'timeout', { step: 'reserve' })
        await notifyDispatcher(sb, ctx.id, '⚠️ Mission libre à dispatcher', `${ctx.info} — personne n'a répondu (${p.reason ? `${p.reason}, puis ` : ''}${name} en réserve).`)
        await logEvent(sb, { mission_id: ctx.id }, 'to_dispatcher', { reason: 'réserve sans réponse' })
        stats.escalated++
      }
    } catch (e: any) {
      console.error('[market-proposals] tick échoué pour', p.id, e?.message)
    }
  }
  return stats
}

// ── Mode test (/proposition/test) ─────────────────────────────────────────

export const TEST_MISSION = {
  id: 'test', mission_number: null, source: 'vab', mission_type: 'remorquage', client_name: 'Client fictif (test)',
  vehicle_plate: '1-ABC-123', vehicle_brand: 'Volkswagen', vehicle_model: 'Golf',
  incident_address: 'Rue de la Station 1', incident_city: 'Dison', destination_address: '4800 Verviers',
  remarks_general: 'Mission fictive : ce test ne crée aucune vraie mission.', received_at: null,
}

/**
 * Un utilisateur teste le déroulé sur SON téléphone : vraie notif, vrai appel avec
 * le message vocal après 2 min, fin du test après 4 min. Aucune mission réelle,
 * rien à la réserve ni au dispatcher.
 */
export async function startTestProposal(userId: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const sb = createAdminClient()
  const { data: open } = await sb.from('market_proposals').select('id')
    .eq('driver_id', userId).eq('is_test', true).eq('status', 'pending').limit(1)
  if (open?.length) return { ok: true, id: open[0].id }   // un test déjà en cours : on le rouvre
  const { data: p, error } = await sb.from('market_proposals')
    .insert({ mission_id: null, driver_id: userId, step: 'night_first', is_test: true, reason: 'TEST' })
    .select('id').single()
  if (error || !p) return { ok: false, error: error?.message || 'Création impossible' }
  await sendNotification(userId, 'market_proposal', {
    title:      '🧪 TEST — 🚛 Remorquage — VAB · mission proposée',
    body:       'Volkswagen Golf 1-ABC-123 — Dison\nOuvre pour accepter ou dire que tu es déjà en mission.',
    action_url: `/proposition/${p.id}`,
    data:       { proposal_id: p.id, step: 'night_first', test: true },
  }).catch(e => console.error('[market-proposals] notif test échouée', e?.message))
  return { ok: true, id: p.id }
}

async function tickTest(sb: Sb, p: any, stats: { calls: number; closed: number }): Promise<void> {
  const ageMin = (Date.now() - new Date(p.notified_at).getTime()) / 60_000
  if (ageMin >= ESCALATE_AFTER_MIN) {
    const { data: c } = await sb.from('market_proposals').update({ status: 'timeout', closed_reason: 'test' })
      .eq('id', p.id).eq('status', 'pending').select('id').maybeSingle()
    if (!c) return
    if (p.call_id) { const { hangUpCall } = await import('@/lib/teams/call'); await hangUpCall(p.call_id) }
    const call = p.call_id ? 'l’appel est parti' : p.call_error ? `appel impossible : ${String(p.call_error).toLowerCase()}` : 'pas d’appel'
    await sendNotification(p.driver_id, 'market_proposal_update', {
      title: '🧪 Test terminé', body: `En vrai, la mission serait maintenant proposée à la réserve (${call}).`, action_url: `/proposition/${p.id}`,
    }).catch(() => {})
    stats.closed++
  } else if (ageMin >= CALL_AFTER_MIN && !p.call_at) {
    const drivers = await loadDrivers(sb, [p.driver_id])
    await startCall(sb, p, drivers.get(p.driver_id))
    stats.calls++
  }
}

// ── Appel Teams : message vocal quand il décroche ─────────────────────────

/** Événement d'appel reçu par /api/teams/callback. true si l'appel est une proposition de nuit. */
export async function handleProposalCallEvent(callId: string, event: 'established' | 'prompt_completed'): Promise<boolean> {
  const sb = createAdminClient()
  const { data: p } = await sb.from('market_proposals').select('id, status').eq('call_id', callId).maybeSingle()
  if (!p) return false
  const { playPromptOnCall, hangUpCall } = await import('@/lib/teams/call')
  if (event === 'established' && p.status === 'pending') {
    const base = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
    const r = await playPromptOnCall(callId, `${base}${PROPOSAL_SOUND_PATH}`, p.id)
    if (!r.ok) { await sb.from('market_proposals').update({ call_error: `Message vocal non joué : ${r.error}` }).eq('id', p.id); await hangUpCall(callId) }
  } else {
    // Message terminé, ou mission prise entre-temps : on raccroche.
    await hangUpCall(callId)
  }
  return true
}
