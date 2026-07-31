// ============================================================
// VERVIERS DÉPANNAGE — Normalisation marque/modèle sur les fiches
// ------------------------------------------------------------
// Réécrit incoming_missions.vehicle_brand / vehicle_model sur le NOM
// CANONIQUE du catalogue Odoo (nettoyé le 2026-07-31). Si la marque/modèle
// n'existe pas dans Odoo → capitalisation intelligente (BMW/VW/A3 préservés).
//
// Idempotent : ne réécrit que si le libellé change réellement. Ne CRÉE jamais
// de fiche catalogue (lookup pur). Cursor sur created_at (desc) pour dérouler
// l'historique ; le cron sans curseur traite les plus récentes (futur).
// ============================================================

import { odooRpc }                              from '@/lib/odoo'
import { brandKey, modelKey, canonicalBrandKey, smartVehicleCase } from '@/lib/odoo-fleet'

type Sb = ReturnType<typeof import('@/lib/supabase').createAdminClient>

interface CatalogIdx {
  brandByKey: Map<string, { id: number; name: string }>
  modelByKey: Map<string, string>   // `${brandId}|${modelKey}` -> nom canonique
}

let cache: { idx: CatalogIdx; exp: number } | null = null
const TTL = 5 * 60_000

async function loadCatalog(): Promise<CatalogIdx> {
  if (cache && cache.exp > Date.now()) return cache.idx
  const [brands, models] = await Promise.all([
    odooRpc<any[]>('fleet.vehicle.model.brand', 'search_read', [[]], { fields: ['id', 'name'] }),
    odooRpc<any[]>('fleet.vehicle.model', 'search_read', [[]], { fields: ['id', 'name', 'brand_id'] }),
  ])
  const brandByKey = new Map<string, { id: number; name: string }>()
  for (const b of (brands || []).sort((a, b) => a.id - b.id)) {
    const k = brandKey(b.name); if (k && !brandByKey.has(k)) brandByKey.set(k, { id: b.id, name: b.name })
  }
  const modelByKey = new Map<string, string>()
  for (const m of (models || []).sort((a, b) => a.id - b.id)) {
    const bid = Array.isArray(m.brand_id) ? m.brand_id[0] : null; if (!bid) continue
    const k = `${bid}|${modelKey(m.name)}`; if (!modelByKey.has(k)) modelByKey.set(k, m.name)
  }
  const idx = { brandByKey, modelByKey }
  cache = { idx, exp: Date.now() + TTL }
  return idx
}

export interface NormalizeResult { scanned: number; updated: number; nextBefore: string | null; done: boolean }

/**
 * Normalise un lot de fiches. `beforeTs` (ISO) = curseur : ne traite que les
 * fiches dont created_at <= beforeTs (pour dérouler l'historique). Retourne le
 * created_at le plus ancien vu (nextBefore) pour l'appel suivant.
 */
export async function normalizeMissionVehicles(sb: Sb, opts: { batch?: number; beforeTs?: string | null } = {}): Promise<NormalizeResult> {
  const batch = Math.min(Math.max(opts.batch || 800, 1), 2000)
  const { brandByKey, modelByKey } = await loadCatalog()

  const canonBrand = (raw: string | null): { name: string; id: number | null } | null => {
    const v = (raw || '').trim(); if (!v) return null
    const hit = brandByKey.get(canonicalBrandKey(v))
    return hit ? { name: hit.name, id: hit.id } : { name: smartVehicleCase(v), id: null }
  }
  const canonModel = (raw: string | null, brandId: number | null): string | null => {
    const v = (raw || '').trim(); if (!v) return null
    if (brandId != null) { const nm = modelByKey.get(`${brandId}|${modelKey(v)}`); if (nm) return nm }
    return smartVehicleCase(v)
  }

  let q = sb.from('incoming_missions')
    .select('id, created_at, vehicle_brand, vehicle_model')
    .or('vehicle_brand.not.is.null,vehicle_model.not.is.null')
    .order('created_at', { ascending: false })
    .limit(batch)
  if (opts.beforeTs) q = q.lte('created_at', opts.beforeTs)
  const { data, error } = await q
  if (error) throw new Error(error.message)

  const rows = data || []
  let updated = 0
  for (const f of rows) {
    const cb = canonBrand(f.vehicle_brand)
    const nb = cb?.name ?? f.vehicle_brand
    const nm = canonModel(f.vehicle_model, cb?.id ?? null) ?? f.vehicle_model
    const patch: any = {}
    if (f.vehicle_brand && nb && nb !== f.vehicle_brand) patch.vehicle_brand = nb
    if (f.vehicle_model && nm && nm !== f.vehicle_model) patch.vehicle_model = nm
    if (Object.keys(patch).length) { await sb.from('incoming_missions').update(patch).eq('id', f.id); updated++ }
  }

  const done = rows.length < batch
  const nextBefore = done ? null : (rows[rows.length - 1]?.created_at || null)
  return { scanned: rows.length, updated, nextBefore, done }
}
