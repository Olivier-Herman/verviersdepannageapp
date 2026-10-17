// src/lib/snc/depot-final.ts — Siabis non couvert en « REM vers dépôt » (Olivier 17/10/2026) :
//   • véhicule immatriculé en Belgique : il peut passer par notre dépôt puis être relivré → paiement au bureau ;
//   • véhicule étranger : notre dépôt est le STOP FINAL → paiement obligatoire à la clôture, comme un remorquage.
// Fichier sans dépendance serveur : utilisé aussi par l'app chauffeur.

/** Formats belges : 1ABC234 (depuis 2010), ABC123 et 123ABC (anciens). Espaces, tirets et points ignorés. */
export function isBelgianPlate(plate: string | null | undefined): boolean {
  const p = String(plate || '').toUpperCase().replace(/[\s.\-]/g, '')
  return /^\d[A-Z]{3}\d{3}$/.test(p) || /^[A-Z]{3}\d{3}$/.test(p) || /^\d{3}[A-Z]{3}$/.test(p)
}

/** true = le dépôt est l'arrivée finale (plaque étrangère) → on encaisse. Plaque absente : pas de blocage. */
export function sncDepotEstFinal(plate: string | null | undefined): boolean {
  const p = String(plate || '').trim()
  return p.length > 0 && !isBelgianPlate(p)
}
