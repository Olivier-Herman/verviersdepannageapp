// Helpers internes du module i18n. Pas a importer hors de src/lib/i18n.

import { fr } from './dictionaries/fr'
import { sq } from './dictionaries/sq'
import type { Lang } from './types'

const DICTS = { fr, sq } as const

function getByPath(dict: any, path: string): string | undefined {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), dict)
}

function applyParams(s: string, params?: Record<string, string | number>): string {
  if (!params) return s
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
    s,
  )
}

/**
 * Retourne la traduction d une cle dans la langue active. En albanais,
 * suffixe le francais entre parentheses pour aider le dispatcher : "sq (fr)".
 *
 * Fallback : si la cle manque en sq, retourne juste le francais.
 * Si la cle manque aussi en francais, retourne la cle telle quelle (debug).
 */
export function tString(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const frRaw = getByPath(DICTS.fr, key)
  const fr    = typeof frRaw === 'string' ? applyParams(frRaw, params) : null
  if (lang === 'fr') return fr ?? key

  const sqRaw = getByPath(DICTS.sq, key)
  const sq    = typeof sqRaw === 'string' ? applyParams(sqRaw, params) : null
  if (!sq) return fr ?? key
  if (!fr) return sq
  return `${sq} (${fr})`
}

/**
 * Variante structuree pour le composant <T /> qui veut styler le francais
 * differemment du texte principal. Retourne null pour primary si pas traduit.
 */
export function tParts(lang: Lang, key: string, params?: Record<string, string | number>): {
  primary:   string  // texte principal a afficher
  secondary: string | null  // texte en plus petit entre parentheses (fr quand lang=sq)
} {
  const frRaw = getByPath(DICTS.fr, key)
  const fr    = typeof frRaw === 'string' ? applyParams(frRaw, params) : key

  if (lang === 'fr') return { primary: fr, secondary: null }

  const sqRaw = getByPath(DICTS.sq, key)
  const sq    = typeof sqRaw === 'string' ? applyParams(sqRaw, params) : null
  if (!sq) return { primary: fr, secondary: null }
  return { primary: sq, secondary: fr }
}
