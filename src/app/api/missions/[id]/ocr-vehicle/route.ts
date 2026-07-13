// src/app/api/missions/[id]/ocr-vehicle/route.ts
//
// POST { images: string[] }  (base64 SANS le préfixe data:)
//
// Extrait la PLAQUE et le VIN depuis les photos du chauffeur via Claude Haiku
// (vision, multi-images en un seul appel). Utilisé à la clôture quand un des
// deux champs est vide → le chauffeur confirme/corrige. On NE renvoie que des
// valeurs VALIDÉES (format plaque / VIN 17 car.) ; sinon null (jamais inventé).
// Olivier 2026-07-10.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { detectVehicleFromImages } from '@/lib/ocr/vehicle-detect'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Body { images?: string[] }

export async function POST(req: Request, _ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Body
  try {
    const { plate, vin } = await detectVehicleFromImages(body.images || [])
    return NextResponse.json({ ok: true, plate, vin })
  } catch (e: any) {
    console.error('[ocr-vehicle] Claude échec:', e?.message)
    return NextResponse.json({ error: `OCR échec : ${e?.message || e}` }, { status: 500 })
  }
}
