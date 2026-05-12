// src/lib/surcharges.ts
//
// Detection des majorations tarif applicables a une mission, base sur
// (client, jour de la semaine, plage horaire). Les jours feries BE sont
// assimiles a un dimanche (weekday=7).
//
// Cf migration 202605131500_surcharges.sql pour la structure des tables.

import { createAdminClient } from '@/lib/supabase'

// ─── Jours feries BE ─────────────────────────────────────────────────────────

/** Calcule le lundi de Paques (date) pour une annee donnee — algo Meeus/Jones/Butcher. */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const L = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * L) / 451)
  const month = Math.floor((h + L - 7 * m + 114) / 31)
  const day = ((h + L - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + days)
  return r
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Liste des dates feries officiels en Belgique pour une annee (YYYY-MM-DD). */
function belgianHolidays(year: number): Set<string> {
  const easter = easterSunday(year)
  return new Set([
    `${year}-01-01`,           // Jour de l'An
    ymd(addDays(easter, 1)),   // Lundi de Paques
    `${year}-05-01`,           // Fete du Travail
    ymd(addDays(easter, 39)),  // Ascension (Paques + 39)
    ymd(addDays(easter, 50)),  // Lundi de Pentecote (Paques + 50)
    `${year}-07-21`,           // Fete nationale
    `${year}-08-15`,           // Assomption
    `${year}-11-01`,           // Toussaint
    `${year}-11-11`,           // Armistice
    `${year}-12-25`,           // Noel
  ])
}

const _holidayCache = new Map<number, Set<string>>()
export function isBelgianHoliday(date: Date): boolean {
  const year = date.getUTCFullYear()
  let set = _holidayCache.get(year)
  if (!set) {
    set = belgianHolidays(year)
    _holidayCache.set(year, set)
  }
  return set.has(ymd(date))
}

// ─── Detection client + applicable surcharges ────────────────────────────────

export interface ApplicableSurcharge {
  client_key:  string
  client_label: string
  weekday:     number           // 1=Lun..7=Dim (7 si ferie applique)
  weekday_label: string         // 'Mardi', 'Dimanche (ferie)', etc.
  hour_start:  number
  hour_end:    number
  rate_pct:    number           // taux applicable selon type mission
  range_label: string           // ex: '19h-24h'
}

interface MinimalMission {
  source:         string | null
  client_name:    string | null
  mission_type:   string | null
  incident_type:  string | null
  parent_mission_id?: string | null
}

const WEEKDAY_LABELS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

/** Detecte si une mission est de type REM (remorquage) ou DSP (depannage). */
function isRemMission(m: MinimalMission): boolean {
  const mt = (m.mission_type || '').toLowerCase()
  return mt === 'remorquage'
}

/** Normalise un libelle (label OU source) pour comparaison : minuscules, _ a la place des espaces, caracteres alphanumeriques uniquement. */
function normalizeKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

/**
 * Detecte le client_key applicable a une mission :
 *   1. mission.source normalise matche une key active dans surcharge_clients → ce client
 *   2. sinon → 'snc' (fallback hors-contrat)
 *
 * Le cas "Appel Police - Accident" doit etre encode comme une source mission
 * normale (cle 'appel_police_accident') liee a un partenaire Odoo via
 * mission_sources, ou choisie au moment de la creation manuelle.
 */
async function resolveClientKey(mission: MinimalMission, activeKeys: Set<string>): Promise<string> {
  const source = normalizeKey(mission.source || '')
  if (source && activeKeys.has(source)) return source

  return 'snc'
}

/**
 * Retourne les majorations applicables a une mission a un instant donne.
 * Si la date tombe un jour ferie BE, on utilise les regles du dimanche (weekday=7)
 * en signalant 'Dimanche (ferie)'.
 */
export async function getApplicableSurcharges(
  mission: MinimalMission,
  at:      Date,
): Promise<ApplicableSurcharge[]> {
  const sb = createAdminClient()

  // 1. Charger les clients actifs pour resoudre la cle
  const { data: clients } = await sb
    .from('surcharge_clients')
    .select('key, label, active')
    .eq('active', true)
  const activeMap = new Map<string, string>()
  ;(clients || []).forEach(c => activeMap.set(c.key, c.label))

  const clientKey = await resolveClientKey(mission, new Set(activeMap.keys()))
  const clientLabel = activeMap.get(clientKey) || clientKey

  // 2. Determiner le weekday effectif (1-7, fonction Date europeenne : Lun=1, Dim=7)
  // getDay() : 0=Dim..6=Sam → on convertit
  const jsDay = at.getDay()
  const realWeekday = jsDay === 0 ? 7 : jsDay        // 1=Lun..7=Dim
  const holiday = isBelgianHoliday(at)
  const effectiveWeekday = holiday ? 7 : realWeekday

  // 3. Charger les plages pour ce client + ce jour
  const { data: schedules } = await sb
    .from('surcharge_schedules')
    .select('weekday, hour_start, hour_end, rate_dsp_pct, rate_rem_pct')
    .eq('client_key', clientKey)
    .eq('weekday', effectiveWeekday)

  // 4. Filtrer les plages qui couvrent l'heure de la mission
  const hour = at.getHours()
  const minute = at.getMinutes()
  const decimalHour = hour + minute / 60

  const isRem = isRemMission(mission)

  const results: ApplicableSurcharge[] = []
  for (const s of schedules || []) {
    if (decimalHour < s.hour_start) continue
    if (decimalHour >= s.hour_end) continue
    const rate = isRem ? s.rate_rem_pct : s.rate_dsp_pct
    if (rate == null) continue
    results.push({
      client_key:    clientKey,
      client_label:  clientLabel,
      weekday:       effectiveWeekday,
      weekday_label: holiday
        ? `${WEEKDAY_LABELS[effectiveWeekday]} (férié BE)`
        : WEEKDAY_LABELS[effectiveWeekday],
      hour_start:    s.hour_start,
      hour_end:      s.hour_end,
      rate_pct:      Number(rate),
      range_label:   `${s.hour_start}h-${s.hour_end === 24 ? '24h' : s.hour_end + 'h'}`,
    })
  }

  return results
}
