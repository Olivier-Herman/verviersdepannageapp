// Gabarits de véhicule pour les TRANSPORTS (rapatriements) — partie client-safe
// (aucun accès base) : liste, libellés, aide courte, nom de la ligne de devis.
// Olivier 21/09/2026 (grille par gabarit, préalable robot transports).
//
// Le prix d'un transport = prix/km HTVA (grille source × gabarit, table
// transport_tariffs) × km aller-retour depuis le dépôt. Le gabarit « autre »
// n'a pas de ligne dans la grille : le prix/km est saisi sur la fiche.
// Liste stable (concept métier, comme MISSION_TYPES) — pas un référentiel admin.

/** Gabarits qui ont un prix/km dans la grille (source × gabarit). */
export const TRANSPORT_GABARITS = ['voiture', 'monospace', 'l1h1', 'l2h2'] as const
export type TransportGabarit = typeof TRANSPORT_GABARITS[number]

/** Valeurs possibles sur la fiche : la grille + « autre » (prix/km manuel). */
export const TRANSPORT_VEHICLE_CATEGORIES = [...TRANSPORT_GABARITS, 'autre'] as const
export type TransportVehicleCategory = typeof TRANSPORT_VEHICLE_CATEGORIES[number]

export const TRANSPORT_GABARIT_LABELS: Record<TransportVehicleCategory, string> = {
  voiture:   'Voiture',
  monospace: 'Monospace',
  l1h1:      'Camionnette L1/H1',
  l2h2:      'Camionnette L2/H2',
  autre:     'Autre',
}

/** Aide courte affichée sous chaque choix (sans jargon). */
export const TRANSPORT_GABARIT_HELP: Record<TransportVehicleCategory, string> = {
  voiture:   'citadine, berline, break, petit SUV',
  monospace: 'monospace, grand SUV, 4×4',
  l1h1:      'petite camionnette (Berlingo, Kangoo, Transit Connect…)',
  l2h2:      'grande camionnette (Transit, Trafic, Sprinter L2/H2…)',
  autre:     'hors gabarit (camping-car, remorque…) : prix/km convenu',
}

export function isTransportVehicleCategory(v: unknown): v is TransportVehicleCategory {
  return typeof v === 'string' && (TRANSPORT_VEHICLE_CATEGORIES as readonly string[]).includes(v)
}
export function isTransportGabarit(v: unknown): v is TransportGabarit {
  return typeof v === 'string' && (TRANSPORT_GABARITS as readonly string[]).includes(v)
}

/** Libellé lisible d'un gabarit (valeur brute en repli). */
export function transportGabaritLabel(v: string | null | undefined): string {
  if (!v) return '—'
  const k = String(v).toLowerCase().trim()
  return isTransportVehicleCategory(k) ? TRANSPORT_GABARIT_LABELS[k] : v
}

/** Nombre au format belge (virgule), sans zéros inutiles au-delà de 2 décimales. */
const fmtBe = (n: number, max = 4) => {
  const s = n.toFixed(max).replace(/0+$/, '').replace(/\.$/, '')
  const [i, d = ''] = s.split('.')
  return `${i},${d.padEnd(2, '0')}`
}

/**
 * Nom de la ligne de devis / facture d'un transport — UNE seule ligne SERV-KM :
 *   « Transport / rapatriement — Voiture — 512,4 km aller-retour × 1,25 € HTVA — 2026BX123 »
 * Partagé entre le moteur de prix (template_lines) et build-quote-lines pour
 * que le montant affiché soit exactement celui qui part dans le devis.
 */
export function transportQuoteLineName(
  t: { category: string; km_total: number; price_per_km_htva: number },
  missionRef?: string | null,
): string {
  const km = Math.round(t.km_total * 10) / 10
  const base = `Transport / rapatriement — ${transportGabaritLabel(t.category)} — ${fmtBe(km, 1)} km aller-retour × ${fmtBe(t.price_per_km_htva)} € HTVA`
  return missionRef ? `${base} — ${missionRef}` : base
}
