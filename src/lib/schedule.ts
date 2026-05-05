// src/lib/schedule.ts
//
// Helpers timezone-safe pour les plages de garde.
// IMPORTANT : on raisonne en heure locale Belgique (Europe/Brussels) — aussi bien
// côté client (en général déjà OK) que côté serveur (sur Vercel = UTC sans TZ).
// Plages métier :
//   - Jour  : 07h00 - 20h00 (heure locale BE)
//   - Nuit  : 17h00 - 09h00 (cross-midnight)

const BELGIUM_TZ = 'Europe/Brussels'

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
  const h = getBelgiumHour(now)
  return h >= 7 && h < 20
}

export function isInNightSchedule(now: Date = new Date()): boolean {
  const h = getBelgiumHour(now)
  return h >= 17 || h < 9
}
