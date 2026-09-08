// src/lib/parc/nights.ts
//
// Jours de gardiennage = NUITS passées au parc (Olivier 08/09/2026, urgent) :
// « le gardiennage ne peut pas comptabiliser le jour d'entrée dans le parc, ça
// commence le lendemain de l'entrée. Pour faire plus facile, on comptabilise
// par nuit passée chez nous ». Une nuit = un passage de minuit, heure belge.
//   entrée 06/09 06:48 → sortie 08/09 09:00 : 2 nuits (06→07, 07→08)
//   entrée 06/09 22:00 → sortie 07/09 08:00 : 1 nuit
//   entrée et sortie le même jour               : 0
// Remplace les « jours pleins écoulés » (Math.floor sur 24 h) et le
// Math.ceil de la vue dossier, qui comptaient tantôt trop peu, tantôt le jour
// d'entrée.

const DAY_MS = 86_400_000
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Index du jour calendrier belge (nombre de jours depuis l'epoch, en date locale). */
export function brusselsDayIndex(at: string | number | Date): number {
  const d = at instanceof Date ? at : new Date(at)
  const [y, m, day] = fmt.format(d).split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, day) / DAY_MS)
}

/** Instant ISO du minuit belge qui SUIT la date (YYYY-MM-DD) : fin d'une période facturée « jusqu'au JJ/MM inclus ». */
export function brusselsMidnightAfter(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = Math.floor(Date.UTC(y, m - 1, d + 1) / DAY_MS)   // index du lendemain
  for (const offH of [2, 1, 0, 3]) {                                // CEST, CET, garde-fous
    const t = Date.UTC(y, m - 1, d + 1, 0) - offH * 3_600_000
    if (brusselsDayIndex(t) === target && brusselsDayIndex(t - 1000) === target - 1) return new Date(t).toISOString()
  }
  return new Date(Date.UTC(y, m - 1, d + 1, 0) - 2 * 3_600_000).toISOString()
}

/** Nuits passées entre l'entrée et la sortie (sortie absente = maintenant). Jamais négatif. */
export function nightsBetween(start: string | number | Date | null | undefined, end?: string | number | Date | null): number {
  if (!start) return 0
  const s = brusselsDayIndex(start)
  const e = brusselsDayIndex(end ?? Date.now())
  return Math.max(0, e - s)
}
