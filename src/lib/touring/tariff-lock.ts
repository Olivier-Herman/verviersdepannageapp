// src/lib/touring/tariff-lock.ts
//
// Verrouillage tarifaire d'une fiche : dès que Touring a répondu dans Check
// Touring, on fige les champs qui FONT BOUGER LE TARIF (adresses, dates, type,
// source, montant, scénario, dépôt…). Le reste (note, véhicule, client,
// facturation) reste modifiable. Seul un superadmin déverrouille (PIN).

/** Champs dont la modification changerait le tarif → verrouillés. */
export const TARIFF_FIELDS: ReadonlySet<string> = new Set([
  'mission_type', 'incident_type', 'source',
  'incident_address', 'incident_city', 'incident_country',
  'incident_lat', 'incident_lng', 'incident_borne_km', 'incident_sens', 'incident_at',
  'destination_name', 'destination_address', 'destination_lat', 'destination_lng',
  'destination_borne_km', 'destination_sens',
  'redelivery_address', 'redelivery_lat', 'redelivery_lng',
  'extra_addresses',
  'depot_depart_id', 'depot_depart_locked',
  'special_tarif_htva', 'amount_guaranteed', 'amount_to_collect',
  'intervention_date', 'parked_at', 'delivering_at',
  'snc_scenario', 'snc_requires_balisage',
])

/** Retourne les clés « tarifaires » présentes dans un payload de modification. */
export function lockedFieldsIn(payload: Record<string, any>): string[] {
  return Object.keys(payload || {}).filter(k => TARIFF_FIELDS.has(k))
}
