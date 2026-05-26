// Helper d affichage du numero de mission.
// Source de verite = mission_number (BIGINT, sequence demarre a 10000000).
// Fallback en cascade pour les vieilles missions ou les cas degrades :
//   1. #{mission_number}        — format principal (Olivier 2026-05-26)
//   2. external_id              — code court Odoo / TowSoft (legacy)
//   3. dossier_number           — numero dossier client (ex: Touring TPA-xxx)
//   4. id.slice(0, 8)           — 8 premiers chars de l UUID, dernier recours
//
// Utiliser PARTOUT dans l UI a la place d expressions ad-hoc, garantit que le
// jour ou on change le format (ex: ajout prefixe annee), 1 seul endroit a modifier.

export interface MissionRefSource {
  mission_number?: number | null
  external_id?:    string | null
  dossier_number?: string | null
  id?:             string
}

/**
 * Retourne la reference humaine d une mission, prete a afficher.
 * Ne retourne JAMAIS de chaine vide : fallback dernier recours sur "?".
 */
export function formatMissionRef(m: MissionRefSource | null | undefined): string {
  if (!m) return '?'
  if (m.mission_number != null) return `#${m.mission_number}`
  if (m.external_id)            return m.external_id
  if (m.dossier_number)         return m.dossier_number
  if (m.id)                     return m.id.slice(0, 8)
  return '?'
}

/**
 * Variante "longue" qui ajoute la reference secondaire entre parentheses
 * quand pertinent : `#10001234 (TPA-456)`. Utile sur les fiches detail
 * ou les imports.
 */
export function formatMissionRefDetailed(m: MissionRefSource | null | undefined): string {
  if (!m) return '?'
  const main = formatMissionRef(m)
  const secondary = m.dossier_number && m.dossier_number !== main
    ? m.dossier_number
    : (m.external_id && m.external_id !== main ? m.external_id : null)
  return secondary ? `${main} (${secondary})` : main
}
