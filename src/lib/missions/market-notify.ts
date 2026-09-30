// src/lib/missions/market-notify.ts
//
// Garde de nuit Momo Market (idée de Franck, Olivier 30/09/2026) : qui est de garde
// maintenant (1er départ, réserve), toggle de nuit de la réserve, où en est un
// chauffeur occupé. Le déroulé (propositions, appel, réserve, dispatcher) est dans
// lib/missions/market-proposals.ts ; notifyMarketNewMission est le point d'entrée
// appelé à chaque arrivée d'une mission (mail, création manuelle, VAB, Touring,
// Kaze, AXA).

import { createAdminClient } from '@/lib/supabase'
import { computeGardePlan, GARDE_HOURS_DEFAULT, type GardeConfig } from '@/lib/garde/plan'

// Seules les missions VALIDÉES par le dispatch (« En attente ») partent au cycle de nuit :
// « il n'y a que Momo qui peut l'accepter et c'est seulement là qu'elle doit alerter le
// cycle de nuit » (Olivier 01/10/2026, 2GKR944 prise par un chauffeur sans validation Touring).
export const MARKET_STATUSES = ['dispatching']
export const BUSY_STATUSES   = ['assigned', 'accepted', 'in_progress', 'delivering']
export const HIDDEN_SOURCES  = ['garage', 'unknown']

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0) }

/** Heure et date de Bruxelles (Vercel tourne en UTC). */
export function brusselsNow(now = new Date()): { dateIso: string; minutes: number } {
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

export const TYPE_LABEL: Record<string, string> = {
  rem: '🚛 Remorquage', remorquage: '🚛 Remorquage',
  dsp: '🔧 Dépannage', depannage: '🔧 Dépannage', reparation_place: '🔧 Dépannage',
  transport: '🚐 Transport', dpr: '📍 Déplacement vide', vr: '🚗 Véhicule de remplacement',
}

const STATUS_WEIGHT: Record<string, number> = { delivering: 4, in_progress: 3, accepted: 2, assigned: 1 }
export const hhmm = (iso: string) => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
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

/**
 * Arrivée d'une mission libre : la nuit, déroulé des propositions (1er départ →
 * appel → réserve → dispatcher), cf lib/missions/market-proposals.ts. Appelé par
 * le mail, la création manuelle, VAB, Touring, Kaze et AXA. Ne jette jamais.
 */
export async function notifyMarketNewMission(missionId: string): Promise<void> {
  const { startNightFlow } = await import('@/lib/missions/market-proposals')
  await startNightFlow(missionId)
}
