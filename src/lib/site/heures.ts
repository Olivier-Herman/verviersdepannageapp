// src/lib/site/heures.ts — heures du bureau vues par le site public.
//
// Deux usages (lot 1 du site, Olivier 10/11/2026) :
//   · la version de nuit : hors des heures du bureau (réglage `site_heures_bureau`,
//     « 1-5 09:00-17:00, 6 09:00-13:00 », jours fériés fermés — Olivier 10/11/2026 :
//     lundi-vendredi 9 h-17 h, samedi 9 h-13 h), le site pousse l'appel au
//     dépanneur de garde plutôt qu'un formulaire ;
//   · l'échéance promise : « rappel sous 48 h ouvrables » = 48 heures qui ne
//     comptent que les jours ouvrables (lundi-vendredi hors fériés). Une demande
//     du vendredi 16 h est due le mardi 16 h.

import { isBelgianHoliday } from '@/lib/surcharges'

const bxl = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday))
  return { jour: wd === 0 ? 7 : wd, min: Number(p.hour) % 24 * 60 + Number(p.minute) }
}

/** Jour ouvrable en Belgique : lundi-vendredi, hors jours fériés. */
export function jourOuvrable(d: Date): boolean {
  const { jour } = bxl(d)
  return jour <= 5 && !isBelgianHoliday(d)
}

/**
 * Bureau ouvert selon des plages « 1-5 09:00-17:00, 6 09:00-13:00 » (jours 1 = lundi … 7 = dimanche,
 * un jour seul ou un intervalle), fermé les jours fériés. Réglage illisible : ouvert (version de jour).
 */
export function bureauOuvert(spec: string, d = new Date()): boolean {
  const plages = Array.from(spec.matchAll(/(\d)(?:-(\d))?\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/g))
  if (!plages.length) return true
  if (isBelgianHoliday(d)) return false
  const { jour, min } = bxl(d)
  return plages.some(m => jour >= +m[1] && jour <= +(m[2] || m[1]) && min >= +m[3] * 60 + +m[4] && min < +m[5] * 60 + +m[6])
}

/** Échéance à `heures` heures ouvrables : seules comptent les heures des jours ouvrables. */
export function echeanceOuvrable(depart: Date, heures: number): Date {
  const pas = 15 * 60e3
  let t = depart.getTime(), reste = heures * 60 * 60e3
  for (let garde = 0; reste > 0 && garde < 20000; garde++) {
    if (jourOuvrable(new Date(t))) reste -= pas
    t += pas
  }
  return new Date(t)
}
