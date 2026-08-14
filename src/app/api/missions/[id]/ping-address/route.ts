// src/app/api/missions/[id]/ping-address/route.ts
//
// POST — mémorise l'adresse d'un pointage, résolue par le NAVIGATEUR.
//
// Le géocodage ne passe jamais par le serveur (règle maison) : c'est le
// navigateur du superadmin qui interroge Google, puis renvoie le résultat ici
// pour qu'on ne le redemande plus jamais. Une position est immuable — sans ce
// cache, chaque ouverture de fiche rachèterait les mêmes adresses.
// Olivier 2026-08-14.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as any)?.role || ''
  if (!['admin', 'superadmin', 'dispatcher'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const items: { lat: number; lng: number; address: string }[] = Array.isArray(body?.items) ? body.items : []
  if (items.length === 0) return NextResponse.json({ ok: true, saved: 0 })

  const sb = createAdminClient()
  let saved = 0
  for (const it of items.slice(0, 40)) {
    const lat = Number(it.lat), lng = Number(it.lng)
    const address = String(it.address || '').trim().slice(0, 300)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !address) continue
    // Tolérance sur les décimales : la position stockée et celle renvoyée par le
    // client peuvent différer au dernier chiffre.
    const { error } = await sb.from('mission_position_pings')
      .update({ address })
      .eq('mission_id', params.id)
      .gte('lat', lat - 0.00002).lte('lat', lat + 0.00002)
      .gte('lng', lng - 0.00002).lte('lng', lng + 0.00002)
      .is('address', null)
    if (!error) saved++
  }
  return NextResponse.json({ ok: true, saved })
}
