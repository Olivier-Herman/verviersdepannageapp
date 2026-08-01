// src/lib/prestations/belgian-holidays.ts
//
// Jours fériés légaux belges (10) — fixes + mobiles (basés sur Pâques).
// Utilisé pour pré-marquer « Férié » les feuilles de prestations.

/** Dimanche de Pâques (algorithme grégorien anonyme). */
function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const addDays = (base: Date, n: number) => new Date(base.getTime() + n * 86400000)

/** Numéros de jour (1..31) des fériés belges tombant dans la période AAAA-MM. */
export function belgianHolidayDays(period: string): number[] {
  const [y, m] = (period || '').split('-').map(Number)
  if (!y || !m) return []
  const easter = easterSunday(y)
  const dates = [
    new Date(Date.UTC(y, 0, 1)),    // Nouvel An
    addDays(easter, 1),             // Lundi de Pâques
    new Date(Date.UTC(y, 4, 1)),    // Fête du Travail
    addDays(easter, 39),            // Ascension
    addDays(easter, 50),            // Lundi de Pentecôte
    new Date(Date.UTC(y, 6, 21)),   // Fête nationale
    new Date(Date.UTC(y, 7, 15)),   // Assomption
    new Date(Date.UTC(y, 10, 1)),   // Toussaint
    new Date(Date.UTC(y, 10, 11)),  // Armistice
    new Date(Date.UTC(y, 11, 25)),  // Noël
  ]
  return dates
    .filter(d => d.getUTCFullYear() === y && d.getUTCMonth() === m - 1)
    .map(d => d.getUTCDate())
    .sort((a, b) => a - b)
}

/** Applique « Férié » aux jours fériés qui étaient des jours travaillés (h>0),
 *  sans toucher aux jours déjà en absence ni aux jours non travaillés. Renvoie
 *  la nouvelle map `days` et si elle a changé. */
export function applyHolidaysToDays(days: Record<string, any>, period: string): { days: Record<string, any>; changed: boolean } {
  const hol = belgianHolidayDays(period)
  if (!hol.length) return { days, changed: false }
  const out = { ...(days || {}) }
  let changed = false
  for (const d of hol) {
    const v = out[String(d)]
    if (v && v.h > 0 && !v.abs) { out[String(d)] = { abs: 'ferie' }; changed = true }
  }
  return { days: out, changed }
}
