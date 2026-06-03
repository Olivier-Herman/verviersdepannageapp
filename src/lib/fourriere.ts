// src/lib/fourriere.ts
//
// Constantes du module fourriere : mapping state_id Odoo → libelle de zone.
// Tire de PARC_MAPPING dans Verviers-QR (audit 2026-05-13). Ces IDs sont les
// fleet.vehicle.state.id pre-configures dans Odoo.
//
// Si l'admin ajoute de nouvelles zones dans Odoo, les ajouter ici aussi
// (et inversement). Pas de synchronisation automatique pour eviter qu'une
// modif Odoo casse silencieusement le code.

export interface FourriereZone {
  state_id: number
  code:     string        // 'A', 'B', 'B*', 'C', etc.
  label:    string        // libelle affiche dans l'UI
  full_name: string       // nom complet dans Odoo (pour la mise a jour)
  description?: string
}

export const FOURRIERE_ZONES: FourriereZone[] = [
  { state_id: 5,  code: 'A',       label: 'Zone A',     full_name: 'A FOURRIÈRE - ZONE A (ACCIDENT)',          description: 'Accident' },
  { state_id: 6,  code: 'B',       label: 'Zone B',     full_name: 'B FOURRIÈRE - ZONE B' },
  { state_id: 8,  code: 'B*',      label: 'Zone B* VIP', full_name: 'B* FOURRIÈRE - ZONE B* - VÉHICULE VIP',    description: 'Véhicules VIP' },
  { state_id: 7,  code: 'C',       label: 'Zone C',     full_name: 'C FOURRIÈRE - ZONE C' },
  { state_id: 9,  code: 'D',       label: 'Zone D',     full_name: 'D FOURRIÈRE - ZONE D (VÉHICULE ÉTRANGER)', description: 'Véhicules étrangers' },
  { state_id: 10, code: 'E',       label: 'Zone E',     full_name: 'E FOURRIÈRE - ZONE E' },
  { state_id: 11, code: 'F',       label: 'Zone F',     full_name: 'F FOURRIÈRE - ZONE F' },
  { state_id: 12, code: 'G',       label: 'Zone G',     full_name: 'G FOURRIÈRE - ZONE G' },
  { state_id: 14, code: 'H',       label: 'Zone H',     full_name: 'H FOURRIÈRE - ZONE H' },
  { state_id: 13, code: 'I',       label: 'Zone I',     full_name: 'I FOURRIÈRE - ZONE I (DOMAINE)',           description: 'Domaine' },
  { state_id: 29, code: 'J',       label: 'Zone J',     full_name: 'J FOURRIÈRE - ZONE J' },
  { state_id: 30, code: 'K',       label: 'Zone K',     full_name: 'K FOURRIÈRE - ZONE K' },
  { state_id: 17, code: 'L',       label: 'Zone L',     full_name: 'L FOURRIÈRE - ZONE L MAL GARÉE',           description: 'Mal garée' },
  { state_id: 19, code: 'LABO',    label: 'Labo',       full_name: 'LABO FOURRIÈRE SAISIE LABO',               description: 'Saisie labo' },
  { state_id: 25, code: 'S',       label: 'Cyclo',      full_name: 'S FOURRIÈRE SAISIE CYCLO (RACHID)',        description: 'Saisie cyclo (Rachid)' },
  { state_id: 26, code: 'Box',     label: 'Box',        full_name: 'BOX' },
  { state_id: 15, code: 'Transit', label: 'Transit',    full_name: 'TRANSIT',                                   description: 'Zone de transit' },
]

/** Map state_id → FourriereZone pour lookup rapide. */
export const FOURRIERE_ZONE_BY_ID: Record<number, FourriereZone> = Object.fromEntries(
  FOURRIERE_ZONES.map(z => [z.state_id, z])
)

/** IDs des states consideres comme "en fourriere" pour les filtres SQL Odoo. */
export const FOURRIERE_STATE_IDS = FOURRIERE_ZONES.map(z => z.state_id)

/** Statut "Scratch" (24) ou autre : pas en fourriere actuellement mais utilise via PARC_MAPPING Verviers-QR. */
export const SCRATCH_STATE_ID = 24
