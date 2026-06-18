// src/lib/parc/zone-label.ts
//
// Libellé UTILISATEUR d'une zone de parc. La clé technique (parc_zones.key)
// reste inchangée partout dans la logique ; seul l'affichage change.
// Olivier 2026-06-18 : la zone "K" est présentée comme "Relivraison"
// (c'est la file d'attente relivraison), sans toucher au reste du code.

const ZONE_DISPLAY: Record<string, string> = {
  K: 'Relivraison',
}

export function parcZoneLabel(key?: string | null): string {
  if (!key) return '—'
  return ZONE_DISPLAY[key] || key
}
