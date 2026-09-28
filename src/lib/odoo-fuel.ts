// src/lib/odoo-fuel.ts
//
// Carburant VD Soft ↔ Odoo (Olivier 28/09/2026).
// Odoo pré-remplissait « electric » par défaut sur tous les modèles, donc la
// quasi-totalité des véhicules Odoo portent un faux « Électrique ». VD Soft
// ne lit donc plus jamais le carburant d'Odoo : il est saisi sur la fiche.
// À l'envoi, on traduit le libellé VD Soft en code de sélection Odoo
// (Odoo refuse un libellé comme « Diesel »).

const LABEL_TO_ODOO: Record<string, string> = {
  diesel:      'diesel',
  essence:     'gasoline',
  gasoline:    'gasoline',
  electrique:  'electric',
  electric:    'electric',
  hybride:     'full_hybrid',
  gpl:         'lpg',
  lpg:         'lpg',
  cng:         'cng',
  hydrogene:   'hydrogen',
}

/** Libellé VD Soft → code Odoo ; null si inconnu ou « Autre » (on n'écrit rien). */
export function toOdooFuel(label: string | null | undefined): string | null {
  if (!label) return null
  const k = label.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return LABEL_TO_ODOO[k] ?? null
}

/**
 * Faut-il écrire le carburant saisi dans Odoo ? Oui si Odoo est vide ou porte
 * le faux défaut « electric » (valeur polluée), et que la saisie diffère.
 */
export function shouldWriteFuel(current: string | false | null | undefined, next: string | null): boolean {
  if (!next) return false
  if (!current) return true
  return current === 'electric' && next !== 'electric'
}
