// Zones de parc : parc_zones est la SEULE source (Olivier 09/09/2026 — les états
// véhicule Odoo ne sont plus synchronisés depuis que VD Soft est la source de
// vérité). Lecture serveur avec cache 60 s ; côté client : /api/parc/zones-and-depots.
import { createAdminClient } from '@/lib/supabase'

export interface ParcZone { key: string; label: string; sort_order: number; is_pool: boolean; zone_type: string | null; depot_id: string | null }
let cache: { at: number; zones: ParcZone[] } | null = null

export async function listParcZones(): Promise<ParcZone[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.zones
  const sb = createAdminClient()
  const { data } = await sb.from('parc_zones').select('key, label, sort_order, is_pool, zone_type, depot_id').eq('active', true).order('sort_order')
  const zones = (data || []).map((z: any) => ({ key: String(z.key), label: String(z.label || z.key), sort_order: Number(z.sort_order || 0), is_pool: !!z.is_pool, zone_type: z.zone_type ?? null, depot_id: z.depot_id ?? null }))
  cache = { at: Date.now(), zones }
  return zones
}
export async function parcZoneLabelOf(key: string | null | undefined): Promise<string> {
  if (!key) return '—'
  const z = (await listParcZones()).find(z => z.key.toLowerCase() === String(key).toLowerCase())
  return z?.label || String(key)
}
