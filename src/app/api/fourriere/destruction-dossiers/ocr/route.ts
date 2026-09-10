// POST { photos: string[] } → { vin, brand, model, color, condition, confidence }
import { NextResponse }  from 'next/server'
import { fourriereUser } from '@/lib/fourriere/destruction-access'
import { describeVehicleFromImages } from '@/lib/fourriere/destruction-dossier'
export const maxDuration = 60
export async function POST(req: Request) {
  const u = await fourriereUser(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const photos: string[] = Array.isArray(body.photos) ? body.photos : []
  if (!photos.length) return NextResponse.json({ error: 'Aucune photo' }, { status: 400 })
  const r = await describeVehicleFromImages(photos)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
  return NextResponse.json(r.data)
}
