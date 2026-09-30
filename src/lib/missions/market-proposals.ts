// src/lib/missions/market-proposals.ts
//
// Propositions de nuit Momo Market (Olivier 30/09/2026, suite de l'idée de Franck).
//
// Une mission LIBRE arrive la nuit (18:00 → 08:00, planning de garde) :
//  1. 1er départ libre → la mission lui est PROPOSÉE : notif qui ouvre
//     /proposition/<id> avec « J'accepte » / « Je suis déjà en mission ».
//     - 2 min sans réponse → appel Teams avec message vocal fixe (1er départ seul).
//     - 2 min de plus sans réponse → proposée à la réserve.
//     - « Je suis déjà en mission » (appel police, fiche pas encore créée) → proposée
//       à la réserve tout de suite, et il compte comme occupé pendant 1 h ou jusqu'à
//       ce qu'il ait une fiche.
//  2. 1er départ sur une fiche en cours → la proposition va QUAND MÊME d'abord à
//     lui (il peut enchaîner) ; la réserve reçoit seulement une info avec où en est
//     le 1er départ (Olivier 30/09/2026 soir). S'il a répondu « Je suis déjà en
//     mission » il y a moins d'1 h sans fiche depuis → il reçoit l'info et la
//     proposition part chez la réserve.
//  3. Réserve : seulement si son toggle de nuit est actif (dashboard). 4 min sans
//     réponse, ou « déjà en mission » → le dispatcher de garde doit dispatcher.
//  Le dispatcher de garde est informé à chaque passage à la réserve et quand
//  personne ne prend.
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

const CALL_AFTER_MIN      = 2    // notif sans réponse → appel au 1er départ
const ESCALATE_AFTER_MIN  = 4    // … puis 2 min de plus → réserve
const RESERVE_TIMEOUT_MIN = 4    // réserve sans réponse → dispatcher
const DECLARED_BUSY_MIN   = 60   // « Je suis déjà en mission » vaut 1 h (ou jusqu'à sa fiche)

export const PROPOSAL_SOUND_PATH = '/sounds/nouvelle-mission.wav'

/**
 * Interrupteur (app_settings.market_proposals_actif, TEXTE JSON true/false) : tant
 * qu'il n'est pas à true, la nuit reste en simple info (1er départ prévenu, réserve
 * prévenue si le 1er est en mission) ; le mode test fonctionne dans tous les cas.
 * Olivier 30/09/2026 : on active après un test concluant, sans nouveau déploiement.
 */
async function proposalsEnabled(sb: Sb): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'market_proposals_actif').maybeSingle()
  try { return JSON.parse(String(data?.value ?? 'false')) === true } catch { return false }
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
    .select('id, mission_number, status, assigned_to, source, received_at, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_city, incident_address')
    .eq('id', missionId).maybeSingle()
  if (!m) return null
  const source = (m.source || '').toUpperCase()
  return {
    id: m.id, number: m.mission_number ?? null, source, status: m.status, assigned_to: m.assigned_to, received_at: m.received_at,
    type:    TYPE_LABEL[(m.mission_type || '').toLowerCase().trim()] || '📋 Mission',
    vehicle: [m.vehicle_brand, m.vehicle_model, m.vehicle_plate].filter(Boolean).join(' '),
    place:   m.incident_city || m.incident_address || '',
    info:    [m.mission_number ? `#${m.mission_number}` : null, source || null, m.vehicle_plate, m.incident_city].filter(Boolean).join(' · ') || 'Mission',
  }
}

/**
 * Le chauffeur est-il occupé ? Ligne « 👤 Franck : … » si oui, null s'il est libre.
 * Occupé = une fiche en cours (attribuée comprise), ou « Je suis déjà en mission »
 * répondu il y a moins d'1 h sans avoir eu de fiche depuis.
 */
async function busyLine(sb: Sb, driver: Driver): Promise<{ line: string; kind: 'fiche' | 'declared' } | null> {
  const { data: missions } = await sb.from('incoming_missions')
    .select('status, on_way_at, on_site_at, loaded_at, incident_city, incident_address, destination_address')
    .eq('assigned_to', driver.id).in('status', BUSY_STATUSES)
  if (missions?.length) return { line: describeBusy(driver.name, missions), kind: 'fiche' }

  const since = new Date(Date.now() - DECLARED_BUSY_MIN * 60_000).toISOString()
  const { data: declared } = await sb.from('market_proposals').select('responded_at')
    .eq('driver_id', driver.id).eq('status', 'busy').eq('is_test', false).gte('responded_at', since)
    .order('responded_at', { ascending: false }).limit(1)
  const at = declared?.[0]?.responded_at
  if (!at) return null
  const { data: fiche } = await sb.from('incoming_missions').select('id')
    .eq('assigned_to', driver.id).gte('assigned_at', at).limit(1)
  if (fiche?.length) return null   // il a eu une fiche depuis : on se fie de nouveau aux fiches
  return { line: `👤 ${driver.name} : déjà en mission (signalé à ${hhmm(at)})`, kind: 'declared' }
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
  const why = !reserveId ? 'pas de réserve cette nuit'
    : !available(reserve) ? `${reserve?.name || 'la réserve'} (réserve) est hors ligne ou en congé`
    : `${reserve?.name || 'la réserve'} (réserve) a désactivé sa notif de nuit`
  await notifyDispatcher(sb, ctx.id, '⚠️ Mission libre à dispatcher', `${ctx.info} — ${reason} ; ${why}.`)
}

/** Réserve prévenue (info, sans boutons) qu'une mission est proposée au 1er départ occupé. */
async function infoToReserve(sb: Sb, ctx: MissionCtx, duty: GardeNight, firstLine: string): Promise<void> {
  const reserveId = duty.reserve && duty.reserve !== duty.nightFirst ? duty.reserve : null
  if (!reserveId) return
  const reserve = (await loadDrivers(sb, [reserveId])).get(reserveId)
  if (!reserve || !available(reserve) || !reserveNotifOn(reserve.notif_preferences, duty.nightKey)) return
  await sendNotification(reserve.id, 'market_new_mission', {
    title:      `${ctx.type} — ${ctx.source} · proposée au 1er départ`,
    body:       [[ctx.vehicle, ctx.place].filter(Boolean).join(' — ') || 'Nouvelle mission', firstLine, 'Elle te sera proposée s’il ne peut pas la prendre.'].join('\n'),
    action_url: '/missions-dispo',
    mission_id: ctx.id,
    data:       { role: 'reserve' },
  }).catch(e => console.error('[market-proposals] info réserve échouée', e?.message))
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

    if (!(await proposalsEnabled(sb))) { await infoOnlyFlow(sb, ctx, duty); return }

    const drivers = await loadDrivers(sb, [duty.nightFirst])
    const first   = drivers.get(duty.nightFirst)
    if (!first || !available(first)) {
      await escalateToReserve(sb, ctx, duty, `${first?.name || 'Le 1er départ'} est hors ligne ou en congé`, null)
      return
    }
    const busy = await busyLine(sb, first)
    if (!busy || busy.kind === 'fiche') {
      // Proposition d'abord au 1er départ, même s'il termine une mission (il peut enchaîner).
      const created = await createProposal(sb, ctx, first, 'night_first', null, null)
      // 1er départ sur une fiche : la réserve est seulement prévenue (info, sans boutons).
      if (created && busy) await infoToReserve(sb, ctx, duty, busy.line)
      return
    }
    // 1er départ qui a signalé être déjà en mission : l'info + proposition à la réserve.
    await sendNotification(first.id, 'market_new_mission', {
      title:      `${ctx.type} — ${ctx.source} · Momo Market`,
      body:       [ctx.vehicle, ctx.place].filter(Boolean).join(' — ') || 'Nouvelle mission disponible',
      action_url: '/missions-dispo',
      mission_id: ctx.id,
      data:       { role: 'night_first' },
    }).catch(e => console.error('[market-proposals] info 1er départ échouée', e?.message))
    await escalateToReserve(sb, ctx, duty, `${first.name} a signalé être déjà en mission`, busy.line)
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
  if (p.status === 'busy')     return 'Tu as répondu que tu étais déjà en mission.'
  if (p.status === 'timeout')  return 'Délai dépassé : la mission a été passée à la suite.'
  if (p.closed_reason === 'claimed' || p.closed_reason === 'assigned') {
    const { data: u } = p.closed_by ? await sb.from('users').select('name').eq('id', p.closed_by).maybeSingle() : { data: null }
    return p.closed_reason === 'claimed' ? `${u?.name || 'Un autre chauffeur'} a pris la mission.` : `Mission attribuée à ${u?.name || 'un autre chauffeur'} par le dispatch.`
  }
  return 'Cette mission n’est plus disponible.'
}

export async function respondProposal(proposalId: string, userId: string, action: 'accept' | 'busy'): Promise<{ ok: boolean; status: number; error?: string; missionId?: string }> {
  const sb = createAdminClient()
  const { data: p } = await sb.from('market_proposals').select('*').eq('id', proposalId).maybeSingle()
  if (!p || p.driver_id !== userId) return { ok: false, status: 404, error: 'Proposition introuvable' }
  if (p.status !== 'pending') return { ok: false, status: 409, error: await closedMessage(sb, p) }

  if (p.is_test) {
    // Test : on enregistre la réponse, rien d'autre (aucune mission, ni réserve ni dispatch).
    await sb.from('market_proposals').update({ status: action === 'accept' ? 'accepted' : 'busy', responded_at: new Date().toISOString(), closed_reason: 'test' })
      .eq('id', p.id).eq('status', 'pending')
    if (p.call_id) { const { hangUpCall } = await import('@/lib/teams/call'); await hangUpCall(p.call_id) }
    return { ok: true, status: 200 }
  }

  if (action === 'accept') {
    const { claimMission } = await import('@/lib/missions/claim')
    const r = await claimMission(p.mission_id, userId, { via: 'proposal', freshMinutes: null })
    if (!r.ok) {
      // Prise ou retirée entre-temps : la proposition se ferme ; le cron préviendra au besoin.
      await sb.from('market_proposals').update({ status: 'cancelled', closed_reason: 'mission_gone' }).eq('id', p.id).eq('status', 'pending')
      return { ok: false, status: r.status, error: r.error }
    }
    return { ok: true, status: 200, missionId: p.mission_id }
  }

  // « Je suis déjà en mission »
  const now = new Date().toISOString()
  const { data: closed } = await sb.from('market_proposals')
    .update({ status: 'busy', responded_at: now, closed_reason: 'busy' })
    .eq('id', p.id).eq('status', 'pending').select('id').maybeSingle()
  if (!closed) return { ok: false, status: 409, error: 'Cette proposition vient d’être fermée.' }
  if (p.call_id) { const { hangUpCall } = await import('@/lib/teams/call'); await hangUpCall(p.call_id) }

  const ctx = await missionCtx(sb, p.mission_id)
  const { data: me } = await sb.from('users').select('name').eq('id', userId).maybeSingle()
  const name = me?.name || 'Le chauffeur'
  if (ctx && !ctx.assigned_to && MARKET_STATUSES.includes(ctx.status)) {
    if (p.step === 'night_first') {
      const duty = await gardeNight(sb)
      if (duty) await escalateToReserve(sb, ctx, duty, `${name} a répondu : déjà en mission`, `👤 ${name} : déjà en mission (signalé à ${hhmm(now)})`)
    } else {
      await notifyDispatcher(sb, ctx.id, '⚠️ Mission libre à dispatcher', `${ctx.info} — ${name} (réserve) est aussi déjà en mission.`)
    }
  }
  return { ok: true, status: 200, missionId: p.mission_id }
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

      const ageMin = (Date.now() - new Date(p.notified_at).getTime()) / 60_000
      const drivers = await loadDrivers(sb, [p.driver_id])
      const driver  = drivers.get(p.driver_id)
      const name    = driver?.name || 'Le chauffeur'

      if (p.step === 'night_first') {
        if (ageMin >= ESCALATE_AFTER_MIN) {
          const { data: c } = await sb.from('market_proposals').update({ status: 'timeout', closed_reason: 'timeout' })
            .eq('id', p.id).eq('status', 'pending').select('id').maybeSingle()
          if (!c) continue
          if (p.call_id) { const { hangUpCall } = await import('@/lib/teams/call'); await hangUpCall(p.call_id) }
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
        await notifyDispatcher(sb, ctx.id, '⚠️ Mission libre à dispatcher', `${ctx.info} — personne n'a répondu (${p.reason ? `${p.reason}, puis ` : ''}${name} en réserve).`)
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
