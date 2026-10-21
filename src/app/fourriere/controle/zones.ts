// Ordre d'affichage et de scan des zones du contrôle du parc (Olivier 21/10/2026) :
// zones de stockage d'abord (I = zone Domaine), puis la zone tampon (J, relivraison, Transit, SNC) et LABO en dernier.
export const TAMPON = ['J', 'K', 'K1', 'Transit', 'SNC']   // SNC aussi en zone tampon (Olivier 21/10/2026)
export const TAMPON_KEY = 'TAMPON'
export const LAST = [...TAMPON, 'LABO']

/** Hors contrôle pour l'instant : S = cyclos (Olivier 21/10/2026). */
export const EXCLUDED = ['S']

export interface Zone { key: string; label: string; sort_order: number }

export function orderZones(zones: Zone[]): Zone[] {
  const rank = (z: Zone) => (LAST.includes(z.key) ? 2000 + LAST.indexOf(z.key) : z.sort_order)
  return zones.filter(z => !EXCLUDED.includes(z.key)).sort((a, b) => rank(a) - rank(b))
}

export function zoneLabel(z: Zone): string {
  if (z.key === 'I') return 'I · Domaine'
  if (z.key === 'K') return 'K · relivraison'
  if (z.key === 'K1') return 'K1 · attente d’adresse'
  return z.label && z.label !== z.key ? `${z.key} · ${z.label}` : z.key
}
