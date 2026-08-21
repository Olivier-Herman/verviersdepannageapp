// src/lib/feature-flags.ts
//
// Feature flags / mode preview. Permet à un superadmin d'activer une nouvelle vue
// pour lui seul (mode 'superadmin') avant de la généraliser (mode 'all'), sans
// impacter la prod. Table feature_flags (migration 202607051700).
//
//   'off'        → personne (prod inchangée)
//   'superadmin' → visible uniquement pour les superadmins (preview)
//   'all'        → tout le monde (version finale)

import { createAdminClient } from '@/lib/supabase'

export type FlagMode = 'off' | 'superadmin' | 'all'
export const FLAG_MODES: FlagMode[] = ['off', 'superadmin', 'all']

// Cache léger (les flags changent rarement) — invalidé sur écriture.
let cache: { at: number; map: Record<string, FlagMode> } | null = null
const TTL_MS = 30_000

async function loadFlags(): Promise<Record<string, FlagMode>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map
  const sb = createAdminClient()
  const { data } = await sb.from('feature_flags').select('key, mode, applies_from')
  const map: Record<string, FlagMode> = {}
  const depuis: Record<string, string | null> = {}
  for (const f of data || []) {
    map[(f as any).key] = ((f as any).mode as FlagMode) || 'off'
    depuis[(f as any).key] = (f as any).applies_from || null
  }
  cache = { at: Date.now(), map }
  cacheDepuis = depuis
  return map
}

/** Date d'application aux missions (null = pas de gel). */
let cacheDepuis: Record<string, string | null> = {}
export async function getFlagAppliesFrom(key: string): Promise<string | null> {
  try { await loadFlags(); return cacheDepuis[key] || null } catch { return null }
}

export async function getFlagMode(key: string): Promise<FlagMode> {
  try { return (await loadFlags())[key] || 'off' } catch { return 'off' }
}

/** Le user voit-il le preview de ce flag ? (superadmin toujours prioritaire). */
export function previewVisible(mode: FlagMode, role: string | null | undefined): boolean {
  if (mode === 'all') return true
  if (mode === 'superadmin') return role === 'superadmin'
  return false
}

export async function isPreviewOn(key: string, role: string | null | undefined): Promise<boolean> {
  return previewVisible(await getFlagMode(key), role)
}

/**
 * Le drapeau s'applique-t-il à CETTE mission ?
 *
 * « Les missions en cours ne devront pas être prises dans cette mise à jour »
 * (Olivier 2026-08-21). Un chauffeur qui a commencé une intervention sous
 * l'ancien parcours doit la finir sous l'ancien parcours : changer les écrans
 * sous ses doigts, au bord de la route, c'est la meilleure façon de le bloquer.
 *
 * La coupure se fait sur l'ACCEPTATION, pas sur la création : une mission créée
 * hier mais pas encore commencée peut très bien adopter le nouveau parcours.
 * En aperçu (superadmin), aucun gel — c'est fait pour essayer.
 */
export async function flagAppliesToMission(
  key: string,
  role: string | null | undefined,
  mission: { accepted_at?: string | null } | null | undefined,
): Promise<boolean> {
  const mode = await getFlagMode(key)
  if (!previewVisible(mode, role)) return false
  if (mode === 'superadmin') return true
  const depuis = await getFlagAppliesFrom(key)
  if (!depuis) return true
  const acceptee = mission?.accepted_at
  if (!acceptee) return true               // pas encore commencée → nouveau parcours
  return new Date(acceptee).getTime() >= new Date(depuis).getTime()
}

export function invalidateFlagCache() { cache = null }
