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
  const { data } = await sb.from('feature_flags').select('key, mode')
  const map: Record<string, FlagMode> = {}
  for (const f of data || []) map[(f as any).key] = ((f as any).mode as FlagMode) || 'off'
  cache = { at: Date.now(), map }
  return map
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

export function invalidateFlagCache() { cache = null }
