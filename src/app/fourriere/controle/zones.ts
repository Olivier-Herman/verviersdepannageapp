// Ordre d'affichage et de scan des zones du contrôle du parc (Olivier 21/10/2026) :
// zones de stockage d'abord, Domaine, puis la zone tampon (J, relivraison, Transit) et LABO en dernier.
export const TAMPON = ['J', 'K', 'K1', 'Transit']
export const TAMPON_KEY = 'TAMPON'
export const LAST = [...TAMPON, 'LABO']

export interface Zone { key: string; label: string; sort_order: number }

export function orderZones(zones: Zone[]): Zone[] {
  const rank = (z: Zone) => (LAST.includes(z.key) ? 2000 + LAST.indexOf(z.key) : z.key === 'Domaine' ? 1500 : z.sort_order)
  return zones.slice().sort((a, b) => rank(a) - rank(b))
}

export function zoneLabel(z: Zone): string {
  if (z.key === 'K') return 'K · relivraison'
  if (z.key === 'K1') return 'K1 · attente d’adresse'
  return z.label && z.label !== z.key ? `${z.key} · ${z.label}` : z.key
}
