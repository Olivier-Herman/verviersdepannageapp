// src/lib/missions/horaires-depot.ts
//
// Créneau de dépôt accepté par le garage d'une source (Olivier 10/10/2026) : mission_source_catalog.depot_horaires
// = { jours: [1..7] (1 = lundi), de: heure d'ouverture, a: heure de fermeture, feries: dépôt accepté un jour férié }.
// Module sans accès base : utilisé par l'écran chauffeur.

import { belgianHolidayDays } from '@/lib/prestations/belgian-holidays'

export interface HorairesDepot { jours: number[]; de: number; a: number; feries?: boolean }

/** Vrai si, à cet instant (heure belge), le garage n'accepte pas de dépôt. */
export function depotFerme(h: HorairesDepot | null | undefined, quand: Date = new Date()): boolean {
  if (!h || !Array.isArray(h.jours)) return false
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(quand)
  const [jour, heure] = p.split(' ')
  const [y, m, d] = jour.split('-').map(Number)
  const [hh, mm] = heure.split(':').map(Number)
  const js = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  const iso = js === 0 ? 7 : js
  if (!h.jours.includes(iso)) return true
  if (!h.feries && belgianHolidayDays(`${y}-${String(m).padStart(2, '0')}`).includes(d)) return true
  const t = hh + mm / 60
  return t < Number(h.de) || t >= Number(h.a)
}
