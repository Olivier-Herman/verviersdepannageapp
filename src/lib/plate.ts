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
