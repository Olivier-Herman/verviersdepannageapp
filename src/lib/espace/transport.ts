// src/lib/espace/transport.ts
//
// Transport TGR commandé depuis l'espace client (Olivier 16/11/2026) : les trois priorités Touring et
// l'échéance qui en découle. Utilisé par le formulaire (affichage) et par le serveur (enregistrement) :
// une seule règle.
//   Priorité 1 (Arval et Mercedes) : prochain jour ouvrable, avant midi. La fiche part DIRECTEMENT au dispatch,
//                                    prête à attribuer, avec la mention « TGR Priorité 1 » (Olivier 16/11/2026).
//   Priorité 2 (autres contrats)   : prochain jour ouvrable, dans la journée. À valider, placée au planning à 13 h.
//   Priorité 3                     : dès que possible, sans échéance.
// Jour ouvrable = ni dimanche ni jour férié légal belge.

import { aBruxelles, jourBruxelles } from '@/lib/time/bxl-offset'
import { belgianHolidayDays } from '@/lib/prestations/belgian-holidays'

export type PrioriteTransport = 1 | 2 | 3

export const PRIORITES_TRANSPORT: { v: PrioriteTransport; titre: string; sous: string }[] = [
  { v: 1, titre: 'Priorité 1', sous: 'Arval et Mercedes' },
  { v: 2, titre: 'Priorité 2', sous: 'Autres contrats' },
  { v: 3, titre: 'Priorité 3', sous: 'Pas d’échéance' },
]

const estOuvrable = (jour: string): boolean => {
  const d = new Date(`${jour}T12:00:00Z`)
  if (d.getUTCDay() === 0) return false
  return !belgianHolidayDays(jour.slice(0, 7)).includes(d.getUTCDate())
}

/** Prochain jour ouvrable après aujourd'hui (date de Bruxelles « AAAA-MM-JJ »). */
export function prochainJourOuvrable(maintenant = new Date()): string {
  for (let n = 1; n < 15; n++) { const j = jourBruxelles(n, maintenant); if (estOuvrable(j)) return j }
  return jourBruxelles(1, maintenant)
}

const jourLong = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString('fr-BE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })

export interface EcheanceTransport {
  /** Échéance de livraison ; null = dès que possible. */
  echeance: Date | null
  /** Heure à laquelle la fiche est placée au planning ; null = pas de rendez-vous. */
  rdv: Date | null
  /** « mardi 17 novembre, avant midi » */
  libelle: string
}

export function echeanceTransport(priorite: PrioriteTransport, maintenant = new Date()): EcheanceTransport {
  if (priorite === 3) return { echeance: null, rdv: null, libelle: 'Dès que possible' }
  const jour = prochainJourOuvrable(maintenant)
  return priorite === 1
    ? { echeance: aBruxelles(jour, 12), rdv: null, libelle: `${jourLong(jour)}, avant midi` }
    : { echeance: aBruxelles(jour, 23, 59), rdv: aBruxelles(jour, 13), libelle: `${jourLong(jour)}, dans la journée` }
}

/** Priorité 1 : pas de validation, la fiche est tout de suite à attribuer. */
export const transportDirect = (priorite: PrioriteTransport) => priorite === 1

export const lirePriorite = (v: unknown): PrioriteTransport | null => (v === 1 || v === 2 || v === 3 ? v : v === '1' ? 1 : v === '2' ? 2 : v === '3' ? 3 : null)
