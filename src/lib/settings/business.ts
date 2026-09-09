// Lecture serveur des réglages métier (voir business-registry.ts). app_settings.value
// est du TEXTE JSON. Cache mémoire 60 s par instance.
//
// Olivier 09/09/2026 : « les réglages du lot A sont OK, retire le repli ». Les
// valeurs vivent en base (semées par 202609100100) : un réglage absent ou invalide
// est une ERREUR franche, jamais un 0 ou une chaîne vide silencieuse — une facture
// au partenaire 0 ou un mail au Parquet parti nulle part ne doivent pas exister.
import { createAdminClient } from '@/lib/supabase'
import { BUSINESS_SETTINGS } from './business-registry'

const TTL_MS = 60_000
let cache: { at: number; values: Record<string, unknown> } | null = null

async function loadAll(): Promise<Record<string, unknown>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values
  const sb = createAdminClient()
  const { data, error } = await sb.from('app_settings').select('key, value').in('key', BUSINESS_SETTINGS.map(s => s.key))
  if (error) throw new Error(`Réglages métier illisibles : ${error.message}`)
  const values: Record<string, unknown> = {}
  for (const row of data || []) {
    const raw = (row as any).value
    if (raw == null || raw === '') continue
    try { values[(row as any).key] = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { values[(row as any).key] = raw }
  }
  cache = { at: Date.now(), values }
  return values
}

export function invalidateBusinessSettings() { cache = null }
const missing = (key: string) => new Error(`Réglage métier manquant ou invalide : « ${key} » — à renseigner dans /admin/settings (Réglages métier).`)

export async function getBusinessNumber(key: string): Promise<number> {
  const v = (await loadAll())[key]
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) throw missing(key)
  return n
}
export async function getBusinessText(key: string): Promise<string> {
  const v = (await loadAll())[key]
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw missing(key)
  return s
}
export async function getBusinessList(key: string): Promise<string[]> {
  const v = (await loadAll())[key]
  const arr = Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean)
    : typeof v === 'string' && v.trim() ? v.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean) : []
  if (!arr.length) throw missing(key)
  return arr
}
/** Toutes les valeurs (pour l'API et l'écran d'admin) ; une clé manquante vaut null. */
export async function getBusinessSettings(): Promise<Record<string, number | string | string[] | null>> {
  const out: Record<string, number | string | string[] | null> = {}
  for (const s of BUSINESS_SETTINGS) {
    try { out[s.key] = s.kind === 'number' ? await getBusinessNumber(s.key) : s.kind === 'emails' ? await getBusinessList(s.key) : await getBusinessText(s.key) }
    catch { out[s.key] = null }
  }
  return out
}
