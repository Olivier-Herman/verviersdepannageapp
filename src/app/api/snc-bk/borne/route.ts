// src/app/api/snc-bk/borne/route.ts
//
// GET /api/snc-bk/borne?numero_route=A004121&km=15
// Cherche la borne kilometrique precise sur le reseau Geoportail Wallonie
// et retourne ses coordonnees GPS (WGS84).
//
// Si la borne exacte n existe pas, retourne la plus proche en kilometres.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const GEOPORTAIL_BORNES = 'https://geoservices.wallonie.be/arcgis/rest/services/MOBILITE/RES_ROUTIER_REGIONAL/MapServer/2/query'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const numeroRoute = (searchParams.get('numero_route') || '').trim()
  const kmStr       = (searchParams.get('km') || '').trim()
  if (!numeroRoute) {
    return NextResponse.json({ error: 'numero_route requis' }, { status: 400 })
  }
  const km = parseFloat(kmStr)
  if (!isFinite(km)) {
    return NextResponse.json({ error: 'km invalide' }, { status: 400 })
  }

  try {
    // Tente d abord la borne exacte
    const exactParams = new URLSearchParams({
      where:          `NUMERO_ROUTE='${numeroRoute.replace(/'/g, "''")}' AND CUMULEE=${km}`,
      outFields:      'NUMERO_ROUTE,IDENTIFIANT,CUMULEE,TYPE_BORNE',
      f:              'json',
      returnGeometry: 'true',
      outSR:          '4326',
    })
    let res = await fetch(`${GEOPORTAIL_BORNES}?${exactParams}`, { cache: 'no-store' })
    let j = await res.json()
    let features = j.features || []

    // Si pas trouve exact, cherche la borne la plus proche (range +/- 2 km)
    let isApprox = false
    if (features.length === 0) {
      isApprox = true
      const approxParams = new URLSearchParams({
        where:          `NUMERO_ROUTE='${numeroRoute.replace(/'/g, "''")}' AND CUMULEE BETWEEN ${km - 2} AND ${km + 2}`,
        outFields:      'NUMERO_ROUTE,IDENTIFIANT,CUMULEE,TYPE_BORNE',
        f:              'json',
        returnGeometry: 'true',
        outSR:          '4326',
        orderByFields:  'CUMULEE',
      })
      res = await fetch(`${GEOPORTAIL_BORNES}?${approxParams}`, { cache: 'no-store' })
      j = await res.json()
      features = j.features || []
    }

    if (features.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `Aucune borne trouvée pour route ${numeroRoute} au km ${km} (±2 km)`,
      }, { status: 404 })
    }

    // Choisit la borne la plus proche du km demande
    let best = features[0]
    let bestDiff = Math.abs((best.attributes?.CUMULEE || 0) - km)
    for (const f of features) {
      const d = Math.abs((f.attributes?.CUMULEE || 0) - km)
      if (d < bestDiff) {
        best = f
        bestDiff = d
      }
    }

    return NextResponse.json({
      ok:        true,
      is_approx: isApprox,
      numero_route: best.attributes?.NUMERO_ROUTE,
      cumulee:   best.attributes?.CUMULEE,
      identifiant: best.attributes?.IDENTIFIANT,
      lat:       best.geometry?.y,
      lng:       best.geometry?.x,
      label:     `${best.attributes?.NUMERO_ROUTE} BK${best.attributes?.CUMULEE}${isApprox ? ' (approx)' : ''}`,
    })
  } catch (e: any) {
    console.error('[snc-bk/borne]', e.message)
    return NextResponse.json({ error: e.message || 'Erreur Geoportail' }, { status: 500 })
  }
}
