// src/lib/highways/resolve.ts
//
// Résolution "autoroute + borne km → coordonnées GPS", en privilégiant la table
// locale highway_bornes_km (pré-chargée depuis le SPW), avec repli sur l'appel
// SPW en direct si l'autoroute n'est pas encore en base.
//
// Voir spw-bk.ts (couche SPW live) et parse.ts (analyse de l'adresse libre).

import { createAdminClient } from '@/lib/supabase'
import { resolveBkToCoords as resolveLiveSpw, fetchAllBornesFromSpw, type BkResolution } from './spw-bk'

export type { BkResolution } from './spw-bk'

/**
 * Résout une borne à partir de la table locale (interpolation entre la borne
 * juste en dessous et juste au-dessus). Repli SPW live si l'autoroute est
 * absente de la table.
 */
export async function resolveBk(highwayRef: string, km: number): Promise<BkResolution | null> {
  if (!highwayRef || !Number.isFinite(km) || km < 0) return null
  const ref = highwayRef.toUpperCase()
  const targetM = Math.round(km * 1000)
  const sb = createAdminClient()

  const [belowRes, aboveRes] = await Promise.all([
    sb.from('highway_bornes_km').select('cumulee_m, lat, lng')
      .eq('highway_ref', ref).lte('cumulee_m', targetM)
      .order('cumulee_m', { ascending: false }).limit(1).maybeSingle(),
    sb.from('highway_bornes_km').select('cumulee_m, lat, lng')
      .eq('highway_ref', ref).gte('cumulee_m', targetM)
      .order('cumulee_m', { ascending: true }).limit(1).maybeSingle(),
  ])

  const below = belowRes.data as { cumulee_m: number; lat: number; lng: number } | null
  const above = aboveRes.data as { cumulee_m: number; lat: number; lng: number } | null

  if (below && above) {
    if (below.cumulee_m === above.cumulee_m) {
      return { lat: below.lat, lng: below.lng, highwayRef: ref, km, exact: below.cumulee_m === targetM, source: 'spw' }
    }
    const frac = (targetM - below.cumulee_m) / (above.cumulee_m - below.cumulee_m)
    return {
      lat: below.lat + frac * (above.lat - below.lat),
      lng: below.lng + frac * (above.lng - below.lng),
      highwayRef: ref, km, exact: false, source: 'spw',
    }
  }
  if (below || above) {
    const b = (below || above)!
    return { lat: b.lat, lng: b.lng, highwayRef: ref, km, exact: b.cumulee_m === targetM, source: 'spw' }
  }

  // Autoroute absente de la table → repli sur le SPW en direct.
  return resolveLiveSpw(ref, km)
}

/**
 * (Re)synchronise toutes les bornes d'une autoroute depuis le SPW vers la table
 * locale. Retourne le nombre de bornes chargées.
 */
export async function syncHighwayBornes(highwayRef: string): Promise<{ ok: boolean; count: number; error?: string }> {
  const ref = highwayRef.toUpperCase()
  const bornes = await fetchAllBornesFromSpw(ref)
  if (bornes.length === 0) return { ok: false, count: 0, error: 'Aucune borne trouvée au SPW pour ' + ref }

  const sb = createAdminClient()
  const rows = bornes.map(b => ({ highway_ref: ref, cumulee_m: b.cumulee, lat: b.lat, lng: b.lng, updated_at: new Date().toISOString() }))
  const { error } = await sb.from('highway_bornes_km').upsert(rows, { onConflict: 'highway_ref,cumulee_m' })
  if (error) return { ok: false, count: 0, error: error.message }
  return { ok: true, count: rows.length }
}
