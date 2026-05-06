// src/app/api/depots/route.ts
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

const GMAPS_KEY = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/**
 * Fallback geocoding : si l'utilisateur a saisi une adresse sans cliquer
 * une suggestion Google (donc lat/lng = null), on tente un geocoding
 * côté serveur pour obtenir les coords. Sinon le calcul KM ne marchera pas.
 */
async function geocodeIfMissing(addr: string, lat: number | null | undefined, lng: number | null | undefined): Promise<{ lat: number | null; lng: number | null }> {
  if (lat != null && lng != null) return { lat, lng }
  if (!GMAPS_KEY || !addr?.trim()) return { lat: null, lng: null }
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${GMAPS_KEY}&language=fr`
    const r = await fetch(url)
    const j = await r.json()
    const loc = j.results?.[0]?.geometry?.location
    if (loc?.lat != null && loc?.lng != null) {
      return { lat: loc.lat, lng: loc.lng }
    }
  } catch {}
  return { lat: null, lng: null }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('depots')
    .select('*')
    .eq('active', true)
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const supabase = createAdminClient()
  const { lat, lng } = await geocodeIfMissing(body.address, body.lat, body.lng)
  const { data, error } = await supabase
    .from('depots')
    .insert({
      name:       body.name,
      address:    body.address,
      lat,
      lng,
      is_default: body.is_default ?? false,
      active:     true,
      sort_order: body.sort_order ?? 0,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  if (!body.id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const supabase = createAdminClient()
  const { lat, lng } = await geocodeIfMissing(body.address, body.lat, body.lng)
  const { data, error } = await supabase
    .from('depots')
    .update({
      name:       body.name,
      address:    body.address,
      lat,
      lng,
      is_default: body.is_default ?? false,
      sort_order: body.sort_order ?? 0,
    })
    .eq('id', body.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const supabase = createAdminClient()
  const { error } = await supabase.from('depots').update({ active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
