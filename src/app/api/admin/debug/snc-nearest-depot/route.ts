// src/app/api/admin/debug/snc-nearest-depot/route.ts
//
// Olivier 2026-06-02 PM : debug du calcul de depot le plus proche pour SNC/SC.
// Aide a diagnostiquer pourquoi le systeme retient Pepinster au lieu de Tiege
// pour une intervention donnee (A27 Jalhay par ex).
//
// GET /api/admin/debug/snc-nearest-depot?lat=50.55&lng=5.95
// Retourne :
//   - liste de tous les depots actifs avec lat/lng
//   - distance haversine pour chacun (km a vol d oiseau)
//   - distance route Google Distance Matrix pour chacun (si cle dispo)
//   - le depot retenu par chaque methode
//
// Acces : admin / superadmin uniquement (info technique).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const GMAPS_KEY = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden — admin uniquement' }, { status: 403 })
  }

  const url = new URL(req.url)
  const lat = Number(url.searchParams.get('lat'))
  const lng = Number(url.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({
      error: 'lat + lng requis (query params). Ex: ?lat=50.5728&lng=5.9789 (Jalhay A27)',
    }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: depotsRaw } = await sb
    .from('depots')
    .select('id, name, address, lat, lng, active, sort_order')
    .order('sort_order')
    .order('name')

  const depots = depotsRaw || []

  // Distance haversine pour chaque
  const withHaversine = depots.map(d => ({
    ...d,
    haversine_km:     d.lat != null && d.lng != null ? Math.round(haversineKm(lat, lng, d.lat, d.lng) * 10) / 10 : null,
    excluded_reason:  !d.active             ? 'inactive (active=false)'
                    : d.lat == null         ? 'lat manquante'
                    : d.lng == null         ? 'lng manquante'
                    : null,
  }))

  const eligibles = withHaversine.filter(d => !d.excluded_reason)

  // Distance Matrix Google : 1 appel multi-origins
  let distanceMatrixResult: any = { skipped: 'pas de cle GMAPS_KEY' }
  if (GMAPS_KEY && eligibles.length > 0) {
    try {
      const origins = eligibles.map(d => `${d.lat},${d.lng}`).join('|')
      const gUrl = `https://maps.googleapis.com/maps/api/distancematrix/json` +
                   `?origins=${encodeURIComponent(origins)}` +
                   `&destinations=${lat},${lng}` +
                   `&mode=driving&units=metric&key=${GMAPS_KEY}`
      const res = await fetch(gUrl)
      const j   = await res.json()
      distanceMatrixResult = {
        status: j.status,
        error_message: j.error_message,
        rows: (j.rows || []).map((row: any, i: number) => ({
          depot: eligibles[i]?.name,
          element_status: row?.elements?.[0]?.status,
          distance_text:  row?.elements?.[0]?.distance?.text,
          distance_meters: row?.elements?.[0]?.distance?.value,
        })),
      }
    } catch (e: any) {
      distanceMatrixResult = { error: e.message }
    }
  }

  // Le plus proche par haversine
  const nearestHaversine = eligibles.length > 0
    ? eligibles.reduce((best, d) => (d.haversine_km! < (best?.haversine_km ?? Infinity) ? d : best), eligibles[0])
    : null

  // Le plus proche par route (si dispo)
  let nearestByRoute: any = null
  if (distanceMatrixResult.rows) {
    let bestIdx = -1
    let bestMeters = Infinity
    for (let i = 0; i < distanceMatrixResult.rows.length; i++) {
      const m = distanceMatrixResult.rows[i].distance_meters
      if (typeof m === 'number' && m < bestMeters) {
        bestMeters = m
        bestIdx = i
      }
    }
    nearestByRoute = bestIdx >= 0 ? {
      name: eligibles[bestIdx]?.name,
      distance_km: Math.round(bestMeters / 100) / 10,
    } : null
  }

  return NextResponse.json({
    query: { lat, lng },
    depots_total:     depots.length,
    depots_eligible:  eligibles.length,
    gmaps_key_present: Boolean(GMAPS_KEY),
    depots_detail: withHaversine,
    nearest_by_haversine: nearestHaversine ? { name: nearestHaversine.name, distance_km: nearestHaversine.haversine_km } : null,
    nearest_by_route:    nearestByRoute,
    distance_matrix_raw: distanceMatrixResult,
    interpretation: nearestByRoute
      ? `Le code retiendra : ${nearestByRoute.name} (${nearestByRoute.distance_km} km par route)`
      : `Pas de Distance Matrix → fallback haversine : ${nearestHaversine?.name || '—'}`,
  })
}
