// src/lib/highways/spw-bk.ts
//
// Résolveur "borne kilométrique autoroute → coordonnées GPS", via le service
// cartographique OFFICIEL du Service Public de Wallonie (SPW) — réseau routier
// régional, couche "Bornes kilométriques". Public, gratuit, sans clé.
//
//   https://geoservices.wallonie.be/arcgis/rest/services/MOBILITE/RES_ROUTIER_REGIONAL/MapServer/2
//
// Le champ CUMULEE est le kilométrage cumulé EN MÈTRES (km0 = 0, km1000 = 1 km…).
// On encadre la borne demandée par la borne juste en dessous et juste au-dessus,
// puis on interpole linéairement la position. Précision largement suffisante
// (bornes tous les 1 km, autoroute quasi rectiligne entre deux bornes).
//
// Couverture : Wallonie uniquement (l'essentiel des interventions SIABIS). Les
// autoroutes en Flandre ou au Luxembourg ne sont pas dans cette source.

const SPW_BORNES_URL =
  'https://geoservices.wallonie.be/arcgis/rest/services/MOBILITE/RES_ROUTIER_REGIONAL/MapServer/2/query'

export interface BkResolution {
  lat:        number
  lng:        number
  highwayRef: string
  km:         number
  exact:      boolean   // true si une borne pile sur le km demandé
  source:     'spw'
}

// Cache mémoire simple (le process Vercel peut être réutilisé entre requêtes).
const cache = new Map<string, { at: number; val: BkResolution | null }>()
const TTL_MS = 24 * 60 * 60 * 1000

export interface SpwBorne { cumulee: number; lat: number; lng: number }

async function fetchBorne(highwayRef: string, targetM: number, side: 'below' | 'above'): Promise<SpwBorne | null> {
  const op = side === 'below' ? '<=' : '>='
  const order = side === 'below' ? 'CUMULEE DESC' : 'CUMULEE ASC'
  const where = `NUMERO_ROUTE='${highwayRef}' AND CUMULEE${op}${targetM}`
  const url = `${SPW_BORNES_URL}?where=${encodeURIComponent(where)}`
    + `&outFields=CUMULEE&returnGeometry=true&outSR=4326`
    + `&orderByFields=${encodeURIComponent(order)}&resultRecordCount=1&f=json`

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'VDSoft/1.0 (dispatch)' }, signal: ctrl.signal })
    if (!r.ok) return null
    const j: any = await r.json()
    const f = (j.features || [])[0]
    if (!f || !f.geometry || typeof f.geometry.x !== 'number') return null
    return { cumulee: f.attributes.CUMULEE, lat: f.geometry.y, lng: f.geometry.x }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * Résout une borne kilométrique d'autoroute wallonne en coordonnées GPS.
 * @param highwayRef ex "A27" (lettre A + numéro, sans zéro de tête)
 * @param km ex 22.3 (kilomètres décimaux)
 */
export async function resolveBkToCoords(highwayRef: string, km: number): Promise<BkResolution | null> {
  if (!highwayRef || !Number.isFinite(km) || km < 0) return null
  const ref = highwayRef.toUpperCase()
  const targetM = Math.round(km * 1000)

  const key = `${ref}:${targetM}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.val

  const [below, above] = await Promise.all([
    fetchBorne(ref, targetM, 'below'),
    fetchBorne(ref, targetM, 'above'),
  ])

  let val: BkResolution | null = null

  if (below && above) {
    if (below.cumulee === above.cumulee) {
      val = { lat: below.lat, lng: below.lng, highwayRef: ref, km, exact: below.cumulee === targetM, source: 'spw' }
    } else {
      const frac = (targetM - below.cumulee) / (above.cumulee - below.cumulee)
      val = {
        lat: below.lat + frac * (above.lat - below.lat),
        lng: below.lng + frac * (above.lng - below.lng),
        highwayRef: ref, km, exact: false, source: 'spw',
      }
    }
  } else if (below || above) {
    // Extrémité de l'autoroute : on prend la borne disponible (approx).
    const b = (below || above)!
    val = { lat: b.lat, lng: b.lng, highwayRef: ref, km, exact: b.cumulee === targetM, source: 'spw' }
  }

  cache.set(key, { at: Date.now(), val })
  return val
}

/**
 * Récupère TOUTES les bornes d'une autoroute depuis le SPW (pour pré-charger /
 * resynchroniser la table locale highway_bornes_km).
 */
export async function fetchAllBornesFromSpw(highwayRef: string): Promise<SpwBorne[]> {
  const ref = highwayRef.toUpperCase()
  const where = `NUMERO_ROUTE='${ref}'`
  const url = `${SPW_BORNES_URL}?where=${encodeURIComponent(where)}`
    + `&outFields=CUMULEE&returnGeometry=true&outSR=4326`
    + `&orderByFields=${encodeURIComponent('CUMULEE ASC')}&f=json`

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'VDSoft/1.0 (dispatch)' }, signal: ctrl.signal })
    if (!r.ok) return []
    const j: any = await r.json()
    const out: SpwBorne[] = []
    const seen = new Set<number>()
    for (const f of j.features || []) {
      const g = f.geometry, a = f.attributes
      if (!g || typeof g.x !== 'number' || typeof a?.CUMULEE !== 'number') continue
      const cum = Math.round(a.CUMULEE)
      if (seen.has(cum)) continue
      seen.add(cum)
      out.push({ cumulee: cum, lat: g.y, lng: g.x })
    }
    return out
  } catch {
    return []
  } finally {
    clearTimeout(t)
  }
}
