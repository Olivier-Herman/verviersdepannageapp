// src/types/vehicles.ts
//
// Types partagés entre l'API /api/vehicles/lookup-by-plate, le composant
// <VehiclePlateLookup> et les écrans consommateurs (encaissement, police,
// avance-fonds).

export interface Partner {
  id:          number
  name:        string
  phone:       string
  email:       string
  /** Adresse formatée "rue, code postal, ville" */
  address:     string
  street:      string
  zip:         string
  city:        string
  /** Code ISO 2 lettres (ex: "BE") ou nom lisible Odoo en fallback */
  countryCode: string
  vat:         string
}

export interface VehicleMatch {
  id:            number
  plate:         string
  /** Marque résolue via fleet.vehicle.model.brand_id (pas le display_name) */
  brand:         string
  /** Modèle résolu via fleet.vehicle.model.name (pas display_name "Brand/Model") */
  model:         string
  vin:           string | null
  fuel:          string | null
  gearbox:       string | null
  color:         string | null
  /** True si fleet.vehicle.active = false côté Odoo */
  archived:      boolean
  /** Owner actuel Odoo (driver_id) — null si non assigné */
  currentDriver: { id: number; name: string } | null
  /** Optionnel : présent uniquement si la requête API utilise withPreviousClients=1 */
  previousClients?: Partner[]
}

export interface LookupByPlateResponse {
  found:    boolean        // = vehicles.length > 0
  plate:    string         // version normalisée
  vehicles: VehicleMatch[] // toujours array (multi-match supporté)
}
