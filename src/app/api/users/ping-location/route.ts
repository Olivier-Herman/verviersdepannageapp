// src/app/api/users/ping-location/route.ts
//
// Recoit un ping GPS du chauffeur (foreground app uniquement) et met a jour
// users.last_location_lat / lng / location_updated_at.
// Permet au dispatcher de voir en temps reel ou se trouve chaque chauffeur.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { lat, lng } = await req.json()
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'lat/lng numeriques requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: user } = await sb
    .from('users').select('id').eq('email', session.user!.email!).single()
  if (!user) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })

  await sb.from('users').update({
    last_location_lat:   lat,
    last_location_lng:   lng,
    location_updated_at: new Date().toISOString(),
  }).eq('id', user.id)

  // Olivier 2026-06-16 : si le chauffeur a une (ou des) mission(s) en cours,
  // on historise la position pour tracer le trajet sur la carte dispatch.
  // Best-effort — n'impacte jamais la réponse du ping.
  try {
    const { data: actives } = await sb
      .from('incoming_missions')
      .select('id')
      .eq('assigned_to', user.id)
      .in('status', ['accepted', 'in_progress', 'delivering'])
    if (actives?.length) {
      await sb.from('mission_position_pings').insert(
        actives.map(m => ({ mission_id: m.id, driver_id: user.id, lat, lng, kind: 'ping' }))
      )
    }
  } catch { /* table télémétrie non critique */ }

  return NextResponse.json({ ok: true })
}
