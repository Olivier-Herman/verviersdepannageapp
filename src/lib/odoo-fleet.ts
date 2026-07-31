// ============================================================
// VERVIERS DÉPANNAGE — Résolution marque/modèle Odoo (fleet)
// ------------------------------------------------------------
// Point d'entrée UNIQUE pour retrouver/créer une marque
// (fleet.vehicle.model.brand) et un modèle (fleet.vehicle.model).
// Remplace les findOrCreateBrand/Model dupliqués (odoo.ts,
// odoo-fsm.ts, odoo-fourriere-flows.ts, api/odoo/create-vehicle).
//
// Pourquoi : l'ancien `search_read name ilike <brut>` faisait un
// *contains* qui ratait dès que l'entrant avait un espace/point/tiret
// en trop ("BMW ", "A-5", "Citroën") → il recréait un doublon.
//
// Convention (cf. nettoyage parc 2026-07-31) :
//  - match sur clé ASCII sans accent ni ponctuation ;
//  - millésimes ignorés pour le match (Polo 2015 → Polo) ;
//  - nom créé : ASCII sans accent/tiret/slash, lettre isolée en MAJ ;
//  - réutilise TOUJOURS la fiche existante (id le plus bas = canonique),
//    ne crée qu'en dernier recours (et le loggue).
// ============================================================

export type OdooRpc = <T = any>(model: string, method: string, args?: any[], kwargs?: object) => Promise<T>

const stripAccents = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Clé de comparaison marque : ASCII, minuscules, [a-z0-9] uniquement. */
export const brandKey = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '')

/** Retire les mentions de millésime / comparaison d'un nom de modèle. */
const stripYear = (n: string) => String(n || '')
  .replace(/\(from\s+MY[^)]*\)/gi, '')
  .replace(/\((?:19|20)\d{2}[^)]*\)/g, '')
  .replace(/[<>]=?\s*(?:19|20)?\d{2,4}/g, '')
  .replace(/\bfrom\s+MY\b/gi, '')
  .replace(/\bMY\b/gi, '')
  .replace(/\b(?:19|20)\d{2}\b/g, '')
  .trim().replace(/\s+/g, ' ')

/** Clé de comparaison modèle : millésime retiré puis normalisé. */
export const modelKey = (s: string) => brandKey(stripYear(s))

/** Nom « propre » à créer : ASCII sans accent/tiret/slash, lettre isolée en MAJ. */
export const cleanFleetName = (s: string) => {
  const x = stripAccents(s).replace(/[\-\/]/g, '').trim().replace(/\s+/g, ' ')
  return x.split(' ').map(w => (w.length === 1 && /^[a-z]$/i.test(w)) ? w.toUpperCase() : w).join(' ')
}

// Alias marques : variantes connues → clé canonique (brandKey).
const BRAND_ALIAS: Record<string, string> = {
  vw:          'volkswagenvw',
  volsvagen:   'volkswagenvw',
  volkswagen:  'volkswagenvw',
  mercedesbenz: 'mercedes',
  mb:          'mercedes',
}

// Cache process (30s) pour éviter un full-scan à chaque création de véhicule
// (batch inventaire). Les créations poussent dans le cache → pas de doublon
// intra-batch.
let brandCache: { list: Array<{ id: number; name: string }>; exp: number } | null = null
const modelCache = new Map<number, { list: Array<{ id: number; name: string }>; exp: number }>()
const TTL = 30_000

async function getBrands(rpc: OdooRpc) {
  if (brandCache && brandCache.exp > Date.now()) return brandCache.list
  const list = await rpc<any[]>('fleet.vehicle.model.brand', 'search_read', [[]], { fields: ['id', 'name'] })
  brandCache = { list: list || [], exp: Date.now() + TTL }
  return brandCache.list
}

async function getModels(rpc: OdooRpc, brandId: number) {
  const c = modelCache.get(brandId)
  if (c && c.exp > Date.now()) return c.list
  const list = await rpc<any[]>('fleet.vehicle.model', 'search_read', [[['brand_id', '=', brandId]]], { fields: ['id', 'name'] })
  modelCache.set(brandId, { list: list || [], exp: Date.now() + TTL })
  return list || []
}

/**
 * Résout l'id de la marque : match sur clé normalisée (+ alias), réutilise la
 * fiche canonique (id le plus bas). Ne crée qu'en l'absence de correspondance.
 */
export async function resolveBrandId(rpc: OdooRpc, brandName: string): Promise<number> {
  const raw = String(brandName || '').trim()
  const k0  = brandKey(raw)
  const key = BRAND_ALIAS[k0] || k0
  if (!key) {
    return rpc<number>('fleet.vehicle.model.brand', 'create', [{ name: cleanFleetName(raw) || raw }])
  }
  const brands  = await getBrands(rpc)
  const matches = brands.filter(b => brandKey(b.name) === key).sort((a, b) => a.id - b.id)
  if (matches.length) return matches[0].id

  const name = cleanFleetName(raw) || raw
  const id   = await rpc<number>('fleet.vehicle.model.brand', 'create', [{ name }])
  console.log(`[odoo-fleet] marque créée: "${name}" (id ${id}) — aucune correspondance pour "${raw}"`)
  brandCache?.list.push({ id, name })
  return id
}

/**
 * Résout l'id du modèle dans une marque : match sur clé normalisée (millésime
 * retiré), réutilise la fiche existante. Ne crée qu'en l'absence de correspondance.
 */
export async function resolveModelId(rpc: OdooRpc, brandId: number, modelName: string): Promise<number> {
  const raw = String(modelName || '').trim()
  const key = modelKey(raw)
  if (!key) {
    return rpc<number>('fleet.vehicle.model', 'create', [{ brand_id: brandId, name: cleanFleetName(raw) || raw }])
  }
  const models  = await getModels(rpc, brandId)
  const matches = models.filter(m => modelKey(m.name) === key).sort((a, b) => a.id - b.id)
  if (matches.length) return matches[0].id

  const name = cleanFleetName(stripYear(raw)) || cleanFleetName(raw) || raw
  const id   = await rpc<number>('fleet.vehicle.model', 'create', [{ brand_id: brandId, name }])
  console.log(`[odoo-fleet] modèle créé: "${name}" sous marque ${brandId} — aucune correspondance pour "${raw}"`)
  modelCache.get(brandId)?.list.push({ id, name })
  return id
}
