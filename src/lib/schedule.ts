// src/lib/schedule.ts
//
// Helpers timezone-safe pour les plages de garde.
// IMPORTANT : on raisonne en heure locale Belgique (Europe/Brussels) — aussi bien
// côté client (en général déjà OK) que côté serveur (sur Vercel = UTC sans TZ).
//
// Olivier 2026-06-03 : plages configurables par admin via /admin/garde-schedule.
// Les valeurs par defaut sont fallback si la BDD est inaccessible (client) ou
// vide. Le cache est gere par lib/schedule-cache.ts (server-only) que les
// API routes peuvent override via setScheduleConfig().

const BELGIUM_TZ = 'Europe/Brussels'

export interface PeriodConfig {
  hour_start: number
  hour_end:   number
  cross_midnight: boolean
}

const DEFAULTS = {
  day:                { hour_start: 7,  hour_end: 20, cross_midnight: false } as PeriodConfig,
  night:              { hour_start: 17, hour_end: 9,  cross_midnight: true  } as PeriodConfig,
  autodispatch_night: { hour_start: 18, hour_end: 8,  cross_midnight: true  } as PeriodConfig,
}

// Cache module : les API routes server-only peuvent l override via setScheduleConfig.
let current = { ...DEFAULTS }

export function setScheduleConfig(cfg: Partial<typeof DEFAULTS>): void {
  current = { ...current, ...cfg }
}
export function getScheduleConfig(): typeof DEFAULTS {
  return current
}

function isHourInPeriod(h: number, p: PeriodConfig): boolean {
  if (p.cross_midnight) {
    // ex: 17-9 = [17, 24) ∪ [0, 9)
    return h >= p.hour_start || h < p.hour_end
  }
  return h >= p.hour_start && h < p.hour_end
}

/** Retourne l'heure locale Belgique (0-23) à partir d'un Date donné. */
export function getBelgiumHour(now: Date = new Date()): number {
  // Intl.DateTimeFormat avec timeZone gère DST automatiquement (heure d'été/hiver).
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BELGIUM_TZ,
    hour:     '2-digit',
    hour12:   false,
  }).formatToParts(now)
  const hourPart = parts.find(p => p.type === 'hour')
  return hourPart ? parseInt(hourPart.value, 10) : now.getHours()
}

export function isInDaySchedule(now: Date = new Date()): boolean {
  return isHourInPeriod(getBelgiumHour(now), current.day)
}

export function isInNightSchedule(now: Date = new Date()): boolean {
  return isHourInPeriod(getBelgiumHour(now), current.night)
}

export function isAutoDispatchNight(now: Date = new Date()): boolean {
  return isHourInPeriod(getBelgiumHour(now), current.autodispatch_night)
}
