// src/lib/missions/market-notify.ts
//
// Notif « Nouvelle mission dans Momo Market » la nuit (idée de Franck, Olivier 30/09/2026).
//  - Le 1er départ de la nuit (planning de garde) est prévenu de toute mission libre.
//  - La réserve (garde de la semaine = 2e départ) est prévenue seulement si le 1er
//    départ est en mission à ce moment (attribuée compte comme en mission), et
//    si elle n'a pas coupé sa notif pour la nuit (toggle du dashboard, actif par
//    défaut et réactivé chaque soir à 18 h ; coupure = alerte aux dispatchers).
//  - Dès qu'un chauffeur prend la mission, les autres chauffeurs prévenus et le
//    dispatcher de garde reçoivent « X a pris la mission ».
//  - Plage = horaires de nuit du planning de garde (18:00 → 08:00 par défaut).
//  - Toutes les missions. Le clic ouvre Momo Market : rien n'est attribué, le
//    chauffeur prend la mission lui-même s'il le décide.
// Appelé à chaque arrivée d'une mission (mail, création manuelle, VAB, Touring,
// Kaze, AXA). Ne jette jamais : une notif ratée ne doit pas casser un import.

import { createAdminClient } from '@/lib/supabase'
import { sendNotification } from '@/lib/notifications/send'
import { computeGardePlan, GARDE_HOURS_DEFAULT, type GardeConfig } from '@/lib/garde/plan'
import { getBusinessNumber } from '@/lib/settings/business'

const MARKET_STATUSES = ['new', 'dispatching']
const BUSY_STATUSES   = ['assigned', 'accepted', 'in_progress', 'delivering']
const HIDDEN_SOURCES  = ['garage', 'unknown']

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0) }

/** Heure et date de Bruxelles (Vercel tourne en UTC). */
function brusselsNow(now = new Date()): { dateIso: string; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]))
  return { dateIso: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

export interface GardeNight {
  nightKey:   string          // date (YYYY-MM-DD) du soir où la nuit commence
  inNight:    boolean         // maintenant dans la plage de nuit (18:00 → 08:00 par défaut)
  nightFirst: string | null   // 1er départ de cette nuit
  reserve:    string | null   // réserve = garde de la semaine (2e départ)
}

/**
 * La nuit « courante » : entre minuit et la fin de nuit, c'est celle commencée la
 * veille ; le reste du temps, celle de ce soir (une réserve qui coupe sa notif à
 * 15 h la coupe pour la nuit qui vient).
 */
export async function gardeNight(sb = createAdminClient(), now = new Date()): Promise<GardeNight | null> {
  const { data: row } = await sb.from('app_settings').select('value').eq('key', 'garde_config').maybeSingle()
  if (!row?.value) return null
  let cfg: GardeConfig
  try { cfg = typeof row.value === 'string' ? JSON.parse(row.value) : row.value } catch { return null }
  if (!cfg?.anchor_monday) return null

  const start = toMin(cfg.night_start || GARDE_HOURS_DEFAULT.night_start)
  const end   = toMin(cfg.night_end   || GARDE_HOURS_DEFAULT.night_end)
  const { dateIso, minutes } = brusselsNow(now)
  const [y, m, d] = dateIso.split('-').map(Number)
  const day = new Date(y, m - 1, d)
  if (minutes < end) day.setDate(day.getDate() - 1)   // entre minuit et la fin de nuit → nuit de la veille
  const plan = computeGardePlan(cfg, day, day)[0]
  if (!plan) return null
  return { nightKey: plan.date, inNight: minutes >= start || minutes < end, nightFirst: plan.night_first, reserve: plan.weekly_garde }
}

/** Qui est de garde de nuit MAINTENANT, ou null hors plage de nuit. */
export async function nightDutyNow(sb = createAdminClient(), now = new Date()): Promise<GardeNight | null> {
  const n = await gardeNight(sb, now)
  return n?.inNight ? n : null
}

/**
 * Notif de nuit de la réserve : ACTIVE par défaut, réactivée chaque soir. La
 * réserve peut la couper pour la nuit courante (notif_preferences.market_reserve_off_night
 * = nightKey) ; à 18 h c'est une nouvelle nuit → de nouveau active (Olivier 30/09/2026).
 */
export function reserveNotifOn(prefs: Record<string, unknown> | null | undefined, nightKey: string): boolean {
  return (prefs || {}).market_reserve_off_night !== nightKey
}

const TYPE_LABEL: Record<string, string> = {
  rem: '🚛 Remorquage', remorquage: '🚛 Remorquage',
  dsp: '🔧 Dépannage', depannage: '🔧 Dépannage', reparation_place: '🔧 Dépannage',
  transport: '🚐 Transport', dpr: '📍 Déplacement vide', vr: '🚗 Véhicule de remplacement',
}

const STATUS_WEIGHT: Record<string, number> = { delivering: 4, in_progress: 3, accepted: 2, assigned: 1 }
const hhmm = (iso: string) => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
/** Localité lisible : la ville de la fiche, sinon celle de l'adresse (« 4650 HERVE » → « HERVE »). */
function shortPlace(city?: string | null, addr?: string | null): string {
  if (city?.trim()) return city.trim().replace(/^\d{4}\s+/, '')
  const parts = (addr || '').split(',').map(p => p.trim()).filter(p => p && !/^(belgium|belgique|bel|be|\d{4})$/i.test(p))
  const withZip = parts.find(p => /\b\d{4}\s+\S/.test(p))
  if (withZip) return withZip.replace(/^.*?\b\d{4}\s+/, '')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/**
 * « 👤 Franck : sur place à Dison depuis 23:10, ensuite vers Verviers » — la mission
 * la plus avancée du 1er départ, + « (et 1 autre en attente) » s'il en a plusieurs.
 */
export function describeBusy(name: string, missions: any[]): string {
  const sorted = [...missions].sort((a, b) => (STATUS_WEIGHT[b.status] ?? 0) - (STATUS_WEIGHT[a.status] ?? 0))
  const m = sorted[0]
  const from = shortPlace(m.incident_city, m.incident_address)
  const to   = shortPlace(null, m.destination_address)
  let phase: string
  if (m.status === 'delivering' || m.loaded_at) {
    phase = `chargé${m.loaded_at ? ` depuis ${hhmm(m.loaded_at)}` : ''}${to ? `, en route vers ${to}` : ''}`
  } else if (m.on_site_at) {
    phase = `sur place${from ? ` à ${from}` : ''} depuis ${hhmm(m.on_site_at)}${to ? `, ensuite vers ${to}` : ''}`
  } else if (m.on_way_at) {
    phase = `en route${from ? ` vers ${from}` : ''} depuis ${hhmm(m.on_way_at)}${to ? `, ensuite vers ${to}` : ''}`
  } else {
    phase = `mission attribuée, pas encore parti${from ? ` (${from})` : ''}`
  }
  const more = sorted.length > 1 ? ` (+${sorted.length - 1} autre${sorted.length > 2 ? 's' : ''} en attente)` : ''
  return `👤 ${name} : ${phase}${more}`
}

/** Prévient le 1er départ (et la réserve si besoin) qu'une mission attend dans Momo Market. */
export async function notifyMarketNewMission(missionId: string): Promise<void> {
  try {
    const sb = createAdminClient()
    const duty = await nightDutyNow(sb)
    if (!duty?.nightFirst) return

    const { data: m } = await sb.from('incoming_missions')
      .select('id, status, assigned_to, source, received_at, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_city, incident_address')
      .eq('id', missionId).maybeSingle()
    if (!m || m.assigned_to || !MARKET_STATUSES.includes(m.status) || HIDDEN_SOURCES.includes(m.source || 'unknown')) return
    const freshMin = await getBusinessNumber('momo_market_fresh_minutes').catch(() => 45)
    if (m.received_at && Date.now() - new Date(m.received_at).getTime() > freshMin * 60_000) return

    // Une seule notif par mission (un import peut repasser plusieurs fois).
    const { data: already } = await sb.from('notifications_log').select('id')
      .eq('notif_type', 'market_new_mission').eq('payload->>mission_id', missionId).limit(1)
    if (already?.length) return

    const recipients = [duty.nightFirst]
    let firstBusy: string | null = null   // où en est le 1er départ (ligne ajoutée pour la réserve)
    if (duty.reserve && duty.reserve !== duty.nightFirst) {
      const { data: busy } = await sb.from('incoming_missions')
        .select('status, mission_type, on_way_at, on_site_at, loaded_at, incident_city, incident_address, destination_name, destination_address')
        .eq('assigned_to', duty.nightFirst).in('status', BUSY_STATUSES)
      if (busy?.length) {
        recipients.push(duty.reserve)
        const { data: first } = await sb.from('users').select('name').eq('id', duty.nightFirst).maybeSingle()
        firstBusy = describeBusy(first?.name || '1er départ', busy)
      }
    }

    // Congé en cours, « Hors ligne » manuel ou notifs chauffeur coupées → pas de notif ;
    // réserve : sauf si elle a coupé sa notif pour cette nuit (toggle du dashboard).
    const todayBxl = brusselsNow().dateIso
    const [{ data: users }, { data: leaves }] = await Promise.all([
      sb.from('users').select('id, active, manual_offline, notif_preferences').in('id', recipients),
      sb.from('conge_requests').select('user_id').eq('status', 'approved')
        .lte('start_date', todayBxl).gte('end_date', todayBxl).in('user_id', recipients),
    ])
    const onLeave = new Set((leaves || []).map((l: any) => l.user_id))
    const targets = (users || []).filter((u: any) => {
      const pref = (u.notif_preferences || {}) as Record<string, unknown>
      if (!u.active || u.manual_offline === true || onLeave.has(u.id) || pref.role_driver === false) return false
      if (u.id === duty.reserve && u.id !== duty.nightFirst && !reserveNotifOn(pref, duty.nightKey)) return false
      return true
    }).map((u: any) => u.id as string)
    if (!targets.length) return

    const type    = TYPE_LABEL[(m.mission_type || '').toLowerCase().trim()] || '📋 Mission'
    const vehicle = [m.vehicle_brand, m.vehicle_model, m.vehicle_plate].filter(Boolean).join(' ')
    const place   = m.incident_city || m.incident_address || ''
    const payload = {
      title:      `${type} — ${(m.source || '').toUpperCase()} · Momo Market`,
      body:       [vehicle, place].filter(Boolean).join(' — ') || 'Nouvelle mission disponible',
      action_url: '/missions-dispo',
      mission_id: missionId,
    }
    await Promise.all(targets.map(uid => sendNotification(uid, 'market_new_mission', {
      ...payload,
      // Réserve : on ajoute où en est le 1er départ, pour juger s'il en a encore pour longtemps.
      ...(uid !== duty.nightFirst && firstBusy ? { body: `${payload.body}\n${firstBusy}` } : {}),
      data: { role: uid === duty.nightFirst ? 'night_first' : 'reserve' },
    }).catch(e => console.error('[market-notify] envoi échoué', uid, e?.message))))
  } catch (e: any) {
    console.error('[market-notify] échec (non bloquant):', e?.message)
  }
}

/**
 * Un chauffeur a pris une mission dans Momo Market : prévient les autres chauffeurs
 * qui avaient reçu la notif de cette mission, et le dispatcher de garde.
 */
export async function notifyMarketClaim(missionId: string, driverId: string): Promise<void> {
  try {
    const sb = createAdminClient()
    const [{ data: m }, { data: driver }, { data: notified }, { data: duty }] = await Promise.all([
      sb.from('incoming_missions').select('mission_number, source, vehicle_plate, incident_city').eq('id', missionId).maybeSingle(),
      sb.from('users').select('name').eq('id', driverId).maybeSingle(),
      sb.from('notifications_log').select('user_id').eq('notif_type', 'market_new_mission').eq('payload->>mission_id', missionId),
      sb.from('dispatcher_on_duty').select('user_id').eq('id', 1).maybeSingle(),
    ])
    const who  = driver?.name || 'Un chauffeur'
    const info = [m?.mission_number ? `#${m.mission_number}` : null, (m?.source || '').toUpperCase() || null, m?.vehicle_plate, m?.incident_city]
      .filter(Boolean).join(' · ')

    const drivers = [...new Set((notified || []).map((n: any) => n.user_id as string))].filter(id => id !== driverId)
    const sends = drivers.map(uid => sendNotification(uid, 'market_claimed', {
      title:      `✅ ${who} a pris la mission`,
      body:       `${info || 'Mission'} — plus rien à faire de ton côté`,
      action_url: '/missions-dispo',
      mission_id: missionId,
    }))
    if (duty?.user_id && duty.user_id !== driverId && !drivers.includes(duty.user_id)) {
      sends.push(sendNotification(duty.user_id, 'market_claimed', {
        title:      `🙋 ${who} a pris une mission`,
        body:       `${info || 'Mission'} — prise dans Momo Market`,
        action_url: `/dispatch/${missionId}`,
        mission_id: missionId,
      }))
    }
    await Promise.allSettled(sends)
  } catch (e: any) {
    console.error('[market-notify] notif « mission prise » échouée (non bloquant):', e?.message)
  }
}
