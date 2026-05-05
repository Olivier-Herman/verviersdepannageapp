// src/app/api/geocode/route.ts
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')
  const lat     = searchParams.get('lat')
  const lng     = searchParams.get('lng')

  // GOOGLE_GEOCODING (clé dédiée) sinon fallback sur la clé Maps publique qui supporte aussi Geocoding API
  const apiKey = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Google API key absente' }, { status: 500 })

  // Reverse geocoding (lat/lng → address)
  if (lat && lng) {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=fr`
    )
    const data = await res.json()
    if (data.results?.[0]) {
      return NextResponse.json({ formatted: data.results[0].formatted_address, found: true })
    }
    return NextResponse.json({ found: false })
  }

  // Forward geocoding (address → lat/lng)
  if (!address) return NextResponse.json({ error: 'address or lat/lng requis' }, { status: 400 })

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}&language=fr`
  )
  const data = await res.json()
  if (!data.results?.length) return NextResponse.json({ found: false })

  const result = data.results[0]
  const loc    = result.geometry.location

  // Comparer avec l'adresse originale
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const same = normalize(result.formatted_address).includes(normalize(address.split(',')[0]))

  return NextResponse.json({
    found:     true,
    formatted: result.formatted_address,
    lat:       loc.lat,
    lng:       loc.lng,
    same,
  })
}
