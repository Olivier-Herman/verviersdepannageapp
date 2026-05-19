// src/app/api/admin/tarifs/brackets/route.ts
//
// POST /api/admin/tarifs/brackets
// Cree une nouvelle tranche tarifaire.
// Body : { source, mission_type, from_km, to_km, price_normal, price_majore, effective_from? }
//
// Acces : superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès superadmin requis' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const source       = String(body.source || '').trim()
  const missionType  = String(body.mission_type || '').trim()
  const fromKm       = Number(body.from_km)
  const toKm         = Number(body.to_km)
  const priceNormal  = Number(body.price_normal)
  const priceMajore  = Number(body.price_majore)
  const effectiveFrom = body.effective_from
    ? String(body.effective_from)
    : new Date().toISOString().slice(0, 10)

  if (!source || !missionType) {
    return NextResponse.json({ error: 'source et mission_type requis' }, { status: 400 })
  }
  if (!Number.isFinite(fromKm) || !Number.isFinite(toKm) || toKm < fromKm || fromKm < 0) {
    return NextResponse.json({ error: 'from_km / to_km invalides' }, { status: 400 })
  }
  if (!Number.isFinite(priceNormal) || !Number.isFinite(priceMajore) || priceNormal < 0 || priceMajore < 0) {
    return NextResponse.json({ error: 'price_normal / price_majore invalides' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('source_tariff_brackets')
    .insert({
      source,
      mission_type:   missionType,
      from_km:        fromKm,
      to_km:          toKm,
      price_normal:   priceNormal,
      price_majore:   priceMajore,
      effective_from: effectiveFrom,
      created_by:     user.id || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bracket: data })
}
