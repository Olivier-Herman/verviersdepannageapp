// Grille de restitution fourrière — forme et REPLI (lot A, 09/09/2026). La vraie
// grille vit dans source_tariff_lines (lib/fourriere/restitution-grid.ts) ; ce
// fichier n'a pas d'import serveur pour que la modale puisse s'en servir avant
// la réponse de l'API. Les valeurs de repli sont celles qui étaient codées.
export interface RestitutionGrid {
  source:          string
  label:           string      // « Mal Garée », « Rodéo », « AVP »
  forfaitHtva:     number      // forfait enlèvement HTVA
  forfaitOdooCode: string      // default_code du produit Odoo (PECMG, PECRODEO, PECAVP)
  forfaitLabel:    string      // « Forfait enlèvement Mal Garée »
  minDays:         number      // minimum de jours de gardiennage facturés
  parcDayHtva:     number      // gardiennage €/jour HTVA
  fromCatalog:     boolean     // false = repli codé
}
export const RESTITUTION_FALLBACK: Record<string, RestitutionGrid> = {
  police_mg:    { source: 'police_mg',    label: 'Mal Garée', forfaitHtva: 165.29, forfaitOdooCode: 'PECMG',    forfaitLabel: 'Forfait enlèvement Mal Garée', minDays: 0, parcDayHtva: 20, fromCatalog: false },
  police_rodeo: { source: 'police_rodeo', label: 'Rodéo',     forfaitHtva: 165.29, forfaitOdooCode: 'PECRODEO', forfaitLabel: 'Forfait enlèvement Rodéo',     minDays: 3, parcDayHtva: 20, fromCatalog: false },
  police_avp:   { source: 'police_avp',   label: 'AVP',       forfaitHtva: 165.29, forfaitOdooCode: 'PECAVP',   forfaitLabel: 'Forfait enlèvement AVP',       minDays: 0, parcDayHtva: 20, fromCatalog: false },
}
export const TVA_RATE = 0.21
