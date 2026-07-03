// src/app/api/highways/resolve-bk/route.ts
//
// Résout une adresse d'intervention sur autoroute ("A27 BK22.3 direction
// Luxembourg") en coordonnées GPS, via les bornes kilométriques du SPW.
//
// Query :
//   ?address=A27 BK22.3 direction Luxembourg   (analyse libre)
//   ?highway=A27&km=22.3                        (paramètres explicites)

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { parseHighwayAddress } from '@/lib/highways/parse'
import { resolveBk }        from '@/lib/highways/resolve'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const address = searchParams.get('address')
  let highway = searchParams.get('highway')
  let km = searchParams.get('km') ? parseFloat(searchParams.get('km')!.replace(',', '.')) : null
  let direction: string | null = null
  let borneLabel: string | null = null

  if ((!highway || km == null) && address) {
    const p = parseHighwayAddress(address)
    highway    = highway || p.highwayRef
    km         = km ?? p.km
    direction  = p.direction
    borneLabel = p.borneLabel
  }

  if (!highway || km == null || !Number.isFinite(km)) {
    return NextResponse.json({ ok: false, error: 'Autoroute / borne illisible', highway, km }, { status: 422 })
  }

  const res = await resolveBk(highway, km)
  if (!res) {
    return NextResponse.json({ ok: false, error: `Borne introuvable (${highway} km ${km})`, highway, km }, { status: 404 })
  }

  return NextResponse.json({
    ok:         true,
    lat:        res.lat,
    lng:        res.lng,
    highway:    res.highwayRef,
    km:         res.km,
    borneLabel: borneLabel ?? String(km),
    direction,
    exact:      res.exact,
    source:     res.source,
  })
}
