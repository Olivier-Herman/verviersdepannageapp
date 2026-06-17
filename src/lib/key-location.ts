// src/lib/key-location.ts
// Emplacements possibles de la clé d'un véhicule mis en parc.
// Olivier 2026-06-18.

export const KEY_LOCATIONS: { value: string; label: string; icon: string }[] = [
  { value: 'in_vehicle',        label: 'Dans le véhicule',   icon: '🚗' },
  { value: 'bureau_rac',        label: 'Bureau Rent A Car',  icon: '🏢' },
  { value: 'digibox_rac',       label: 'Digibox Rent A Car', icon: '📦' },
  { value: 'digibox_depannage', label: 'Digibox Dépannage',  icon: '📦' },
  { value: 'no_key',            label: 'Pas de clé',         icon: '🚫' },
]

export const KEY_LOCATION_LABELS: Record<string, string> = Object.fromEntries(
  KEY_LOCATIONS.map(k => [k.value, `${k.icon} ${k.label}`])
)

// Valeur courte affichée sur l'étiquette porte-clé :
//   - n° de crochet si renseigné (clé dans la boîte du bureau),
//   - sinon "IN" si la clé est dans le véhicule,
//   - sinon "NO" si pas de clé,
//   - sinon "—".
export function keyTagValue(keyLocation?: string | null, hook?: string | null): string {
  if (hook && String(hook).trim()) return String(hook).trim()
  if (keyLocation === 'in_vehicle') return 'IN'
  if (keyLocation === 'no_key')     return 'NO'
  return '—'
}
