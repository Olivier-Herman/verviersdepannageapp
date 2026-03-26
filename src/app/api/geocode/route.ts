// src/app/api/geocode/route.ts
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')
  if (!address) return NextResponse.json({ error: 'Adresse manquante' }, { status: 400 })

  const key = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!key)  return NextResponse.json({ error: 'Clé Maps manquante' }, { status: 500 })

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=be&language=fr&key=${key}`
    const res  = await fetch(url)
    const data = await res.json()

    if (data.status !== 'OK' || !data.results?.length) {
      return NextResponse.json({ found: false, original: address })
    }

    const result = data.results[0]
    return NextResponse.json({
      found:     true,
      original:  address,
      formatted: result.formatted_address,
      lat:       result.geometry.location.lat,
      lng:       result.geometry.location.lng,
      same:      result.formatted_address.toLowerCase().includes(address.toLowerCase().split(',')[0].trim()),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
