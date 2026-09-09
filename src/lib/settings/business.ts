// Lecture serveur des réglages métier (voir business-registry.ts). app_settings.value
// est du TEXTE JSON. Cache mémoire 60 s par instance ; repli = valeur du registre.
import { createAdminClient } from '@/lib/supabase'
import { BUSINESS_SETTINGS, businessFallback } from './business-registry'

const TTL_MS = 60_000
let cache: { at: number; values: Record<string, unknown> } | null = null

async function loadAll(): Promise<Record<string, unknown>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values
  const values: Record<string, unknown> = {}
  try {
    const sb = createAdminClient()
    const { data } = await sb.from('app_settings').select('key, value').in('key', BUSINESS_SETTINGS.map(s => s.key))
    for (const row of data || []) {
      const raw = (row as any).value
      if (raw == null || raw === '') continue
      try { values[(row as any).key] = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { values[(row as any).key] = raw }
    }
  } catch { /* repli sur le registre */ }
  cache = { at: Date.now(), values }
  return values
}

export function invalidateBusinessSettings() { cache = null }

export async function getBusinessNumber(key: string): Promise<number> {
  const v = (await loadAll())[key]
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : Number(businessFallback(key) ?? 0)
}
export async function getBusinessText(key: string): Promise<string> {
  const v = (await loadAll())[key]
  const s = typeof v === 'string' ? v.trim() : ''
  return s || String(businessFallback(key) ?? '')
}
export async function getBusinessList(key: string): Promise<string[]> {
  const v = (await loadAll())[key]
  const arr = Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean)
    : typeof v === 'string' && v.trim() ? v.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean) : []
  return arr.length ? arr : ((businessFallback(key) as string[] | undefined) || [])
}
/** Toutes les valeurs résolues (repli inclus) — pour l'API et l'écran d'admin. */
export async function getBusinessSettings(): Promise<Record<string, number | string | string[]>> {
  const out: Record<string, number | string | string[]> = {}
  for (const s of BUSINESS_SETTINGS) out[s.key] = s.kind === 'number' ? await getBusinessNumber(s.key) : s.kind === 'emails' ? await getBusinessList(s.key) : await getBusinessText(s.key)
  return out
}
