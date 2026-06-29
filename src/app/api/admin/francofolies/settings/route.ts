// src/app/api/admin/francofolies/settings/route.ts
//
// Réglages tarifaires Francofolies (superadmin) : prix réquisition + gardiennage.
// Stockés en valeur numérique brute (cohérent avec la lecture Number(value)).
// Olivier 2026-06-29.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'superadmin') {
    return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { price?: number; gardiennage?: number }
  const price = Number(body.price)
  const gard  = Number(body.gardiennage)
  if (!isFinite(price) || price < 0) return NextResponse.json({ error: 'Prix invalide' }, { status: 400 })
  if (!isFinite(gard)  || gard  < 0) return NextResponse.json({ error: 'Gardiennage invalide' }, { status: 400 })

  const sb = createAdminClient()
  for (const [key, value] of [
    ['francofolies_price', String(price)],
    ['francofolies_gardiennage_price', String(gard)],
  ] as const) {
    const { error } = await sb.from('app_settings').upsert({ key, value }, { onConflict: 'key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, price, gardiennage: gard })
}
