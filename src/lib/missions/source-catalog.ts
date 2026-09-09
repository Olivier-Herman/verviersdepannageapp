// Catalogue des sources — familles (tags), libellés variants et groupes de
// facturation. Lot B « admin sans valeurs en dur » (Olivier 09/09/2026) : les
// listes de sources ne vivent plus dans le code, elles sont des tags sur
// mission_source_catalog (voir migration 202609100130 pour la liste des tags).
//
//   const hexalite = await sourcesWithTag('hexalite')         // ['allianz','mondial']
//   await primeSourceCatalog(); sourcesWithTagSync('siabis')  // dans du code synchrone
import { createAdminClient } from '@/lib/supabase'

export type SourceTag =
  | 'hexalite' | 'touring' | 'integration' | 'cloture_externe' | 'saisie_scope' | 'requisitoire'
  | 'panneau_saisie' | 'siabis' | 'rel_reprise' | 'assistance' | 'auto_restitute' | 'rel_tarif_rem'
  | 'ima_family' | 'etiquette'

export interface SourceCatalogRow {
  key: string; label: string; active: boolean; sort_order: number
  tags: string[]; label_tts: string | null; label_etiquette: string | null; label_encaissement: string | null
  billing_group: string | null; display_color: string | null; display_color_hex: string | null; group_key: string | null
}

const TTL_MS = 60_000
let cache: { at: number; rows: SourceCatalogRow[] } | null = null

export async function listSourceCatalog(): Promise<SourceCatalogRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows
  const sb = createAdminClient()
  const { data, error } = await sb.from('mission_source_catalog')
    .select('key, label, active, sort_order, tags, label_tts, label_etiquette, label_encaissement, billing_group, display_color, display_color_hex, group_key')
    .order('sort_order').order('label')
  if (error) throw new Error(`Catalogue des sources illisible : ${error.message}`)
  const rows = (data || []).map((r: any) => ({ ...r, key: String(r.key), label: String(r.label || r.key), tags: Array.isArray(r.tags) ? r.tags : [] })) as SourceCatalogRow[]
  cache = { at: Date.now(), rows }
  return rows
}
export function invalidateSourceCatalog() { cache = null }
/** Charge le cache pour les lecteurs synchrones (grilleAJoindre, filtres). */
export async function primeSourceCatalog(): Promise<void> { await listSourceCatalog() }

/** Clés (actives ou non) portant le tag — l'ordre est celui du catalogue. */
export async function sourcesWithTag(tag: SourceTag): Promise<string[]> {
  return (await listSourceCatalog()).filter(r => r.tags.includes(tag)).map(r => r.key)
}
export async function sourceHasTag(source: string | null | undefined, tag: SourceTag): Promise<boolean> {
  if (!source) return false
  const k = String(source).toLowerCase().trim()
  return (await sourcesWithTag(tag)).some(s => s.toLowerCase() === k)
}
export function sourcesWithTagSync(tag: SourceTag): string[] {
  if (!cache) throw new Error('Catalogue des sources non chargé : appelle primeSourceCatalog() avant sourcesWithTagSync().')
  return cache.rows.filter(r => r.tags.includes(tag)).map(r => r.key)
}
export function sourceHasTagSync(source: string | null | undefined, tag: SourceTag): boolean {
  if (!source) return false
  const k = String(source).toLowerCase().trim()
  return sourcesWithTagSync(tag).some(s => s.toLowerCase() === k)
}

const humanize = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
/** Libellé du catalogue (variante : tts = lu à voix haute, etiquette = étiquette parc, encaissement = motif d'encaissement). */
export async function sourceLabel(source: string | null | undefined, variant: 'label' | 'tts' | 'etiquette' | 'encaissement' = 'label'): Promise<string> {
  if (!source) return '—'
  const k = String(source).toLowerCase().trim()
  const row = (await listSourceCatalog()).find(r => r.key.toLowerCase() === k)
  if (!row) return variant === 'etiquette' ? k.toUpperCase() : humanize(k)
  const v = variant === 'tts' ? row.label_tts : variant === 'etiquette' ? row.label_etiquette : variant === 'encaissement' ? row.label_encaissement : null
  return v || (variant === 'etiquette' ? row.label.toUpperCase() : row.label)
}
/** Groupes de la page Facturation : clé de groupe → sources. */
export async function billingGroups(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const r of await listSourceCatalog()) if (r.billing_group) (out[r.billing_group] ||= []).push(r.key)
  return out
}
