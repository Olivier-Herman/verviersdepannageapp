// src/lib/plate.ts
//
// Helpers de normalisation et validation pour les plaques d'immatriculation
// (utilisés serveur + client). Remplace les 3+ duplications historiques
// dans /api/plates, /api/odoo/search-vehicle, /api/advances/lookup et
// les écrans (PoliceClient, EncaissementClient, AvanceFondsClient).

/**
 * Normalise une plaque : retire espaces, tirets, points, met en MAJUSCULES.
 * Belgique : "1-ABC-234", "1.ABC.234", "1 ABC 234" → "1ABC234"
 */
export function normalizePlate(plate: string): string {
  return plate.replace(/[-.\s]/g, '').toUpperCase().trim()
}

/**
 * Vérifie qu'une plaque est suffisamment longue après normalisation pour
 * lancer un lookup Odoo. Évite les fetches inutiles sur 1-2 caractères.
 */
export function isPlateLookupReady(plate: string): boolean {
  return normalizePlate(plate).length >= 3
}

/**
 * Olivier 2026-06-03 (audit J-2 W11) : fallback plaque vide → 5 derniers
 * chars du VIN. Évite "PAS DE PLAQUE" générique qui casse les recherches
 * et les jointures. Utilise pour les véhicules sans plaque visible
 * (incendies, accidents graves, non immatriculés).
 *
 * Renvoie plate normalisée si valide (>= 3 chars), sinon 5 derniers du VIN.
 */
export function plateOrVinTail(plate: string | null | undefined, vin: string | null | undefined): string {
  const p = (plate || '').toString()
  if (isPlateLookupReady(p)) return normalizePlate(p)
  const v = (vin || '').toString().replace(/[-.\s]/g, '').toUpperCase().trim()
  if (v.length >= 5) return v.slice(-5)
  return ''
}
