// src/lib/missions/source-display.ts
//
// Helper centralise pour l affichage des sources de mission. Toute la app
// doit utiliser ces helpers au lieu de hardcoder des SOURCE_LABELS /
// SOURCE_COLORS par fichier (cf chantier [[admin-zero-hardcode]]).
//
// Les donnees viennent de mission_source_catalog (colonnes label,
// display_color, group_key) chargees au niveau d une page server-side
// et passees en prop a tout composant qui en a besoin.

export interface SourceDisplay {
  key:           string
  label:         string
  display_color: string | null   // classe Tailwind (ex 'bg-blue-600') ou null
  group_key:     string | null   // pour regroupement UI (ex 'police')
}

// Fallbacks utilises si une source n est pas dans le catalog (ex donnees
// historiques avec une cle qui n existe plus). Affiche un badge neutre +
// le label brut transforme en humain.
const FALLBACK_COLOR = 'bg-zinc-600'

export function getSourceLabel(key: string | null | undefined, catalog: SourceDisplay[]): string {
  if (!key) return '—'
  const found = catalog.find(s => s.key === key)
  if (found) return found.label
  // Fallback humanisation : 'police_avp' -> 'Police Avp'
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function getSourceColor(key: string | null | undefined, catalog: SourceDisplay[]): string {
  if (!key) return FALLBACK_COLOR
  const found = catalog.find(s => s.key === key)
  return found?.display_color || FALLBACK_COLOR
}

// Regroupe les sources par group_key pour les dropdowns "meta-choix" (ex
// dispatch/new qui presente 'POLICE' comme une entree synthetique avec
// sub-selector pour les sub-types).
export function groupSources(catalog: SourceDisplay[]): {
  ungrouped: SourceDisplay[]
  groups:    Record<string, SourceDisplay[]>
} {
  const ungrouped: SourceDisplay[] = []
  const groups: Record<string, SourceDisplay[]> = {}
  for (const s of catalog) {
    if (s.group_key) {
      if (!groups[s.group_key]) groups[s.group_key] = []
      groups[s.group_key].push(s)
    } else {
      ungrouped.push(s)
    }
  }
  return { ungrouped, groups }
}
