// src/app/api/snc-bk/routes/route.ts
//
// GET /api/snc-bk/routes
// Retourne la liste des autoroutes wallonnes depuis le Geoportail Wallonie
// (couche RES_ROUTIER_REGIONAL/MapServer/4). Cache 24h cote serveur pour
// eviter les calls repeats.
//
// Permet au composant BornesKmPicker d afficher un combobox des autoroutes.

import { NextResponse } from 'next/server'

export const dynamic   = 'force-dynamic'
export const revalidate = 86400  // 24h

// Couches du service Geoportail :
//   4 = Autoroutes (A4 = E40, etc.)
//   5 = Rings (R0, R3, etc.)
//   6 = Nationales (N3, N62, etc.)
// On agrege les 3 pour avoir TOUTES les routes regionales possibles.
const GEOPORTAIL_BASE = 'https://geoservices.wallonie.be/arcgis/rest/services/MOBILITE/RES_ROUTIER_REGIONAL/MapServer'
const LAYERS = [
  { id: 4, type: 'autoroute' },
  { id: 5, type: 'ring' },
  { id: 6, type: 'nationale' },
]

interface RouteOut {
  numero_route: string
  nom_route:    string
  longueur_km:  number
  type:         string  // 'autoroute' | 'ring' | 'nationale'
}

let cache: { data: RouteOut[]; ts: number } | null = null
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export async function GET() {
  // Cache hit
  if (cache && (Date.now() - cache.ts) < CACHE_TTL_MS) {
    return NextResponse.json({ routes: cache.data, from_cache: true })
  }

  try {
    const byNum = new Map<string, RouteOut>()
    for (const layer of LAYERS) {
      const params = new URLSearchParams({
        where:             '1=1',
        outFields:         'NUMERO_ROUTE,NOM_ROUTE,LONGUEUR_GESTION,TYPE_DESC',
        f:                 'json',
        returnGeometry:    'false',
        resultRecordCount: '5000',
      })
      const res = await fetch(`${GEOPORTAIL_BASE}/${layer.id}/query?${params}`, { cache: 'no-store' })
      if (!res.ok) continue
      const j = await res.json()
      for (const f of (j.features || [])) {
        const a = f.attributes || {}
        const num = a.NUMERO_ROUTE
        if (!num) continue
        if (byNum.has(num)) continue
        byNum.set(num, {
          numero_route: num,
          nom_route:    a.NOM_ROUTE || num,
          longueur_km:  Number(a.LONGUEUR_GESTION) || 0,
          type:         layer.type,
        })
      }
    }
    const routes = Array.from(byNum.values()).sort((a, b) => a.numero_route.localeCompare(b.numero_route))

    cache = { data: routes, ts: Date.now() }
    return NextResponse.json({ routes, from_cache: false, count: routes.length })
  } catch (e: any) {
    console.error('[snc-bk/routes]', e.message)
    return NextResponse.json({ error: e.message || 'Erreur Geoportail' }, { status: 500 })
  }
}
