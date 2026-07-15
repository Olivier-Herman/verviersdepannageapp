// src/lib/garage-closures.ts
//
// Alertes « garage fermé » : quand une adresse de destination/relivraison
// correspond à un garage en fermeture (période), on affiche un message. Les
// règles sont gérées depuis /admin/garage-closures (table garage_closures) et
// lues dynamiquement. Fonction de match PURE (utilisable client + serveur).
// Olivier 2026-07-15.

export interface GarageClosureRule {
  keywords: string[]   // tous requis dans l'adresse (déjà en minuscules)
  message:  string
}

/** Retourne le message si l'adresse matche une règle (tous les mots-clés présents). */
export function matchGarageClosure(address: string | null | undefined, rules: GarageClosureRule[]): string | null {
  const a = (address || '').toLowerCase().trim()
  if (!a || !rules?.length) return null
  for (const r of rules) {
    if (r.keywords.length > 0 && r.keywords.every(k => k && a.includes(k))) return r.message
  }
  return null
}

/** Parse "car avenue, verviers" → ['car avenue','verviers'] (minuscules). */
export function parseKeywords(raw: string | null | undefined): string[] {
  return (raw || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
}
