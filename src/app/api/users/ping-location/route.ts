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
    .from('users').select('id, language').eq('email', session.user!.email!).single()
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

  // Arrivée détectée (Olivier 28/10/2026) : téléphone en poche → notification « Il semblerait que tu arrives… ».
  // Calcul de distance chez nous, aucun service payant. Une seule fois par mission et par étape.
  try { await proposerArrivee(sb, user.id, user.language === 'sq' ? 'sq' : 'fr', lat, lng) } catch (e: any) { console.warn('[ping-location] arrivée', e?.message) }

  return NextResponse.json({ ok: true })
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = (d: number) => d * Math.PI / 180
  const s = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

async function proposerArrivee(sb: any, userId: string, lang: 'fr' | 'sq', lat: number, lng: number) {
  const { data: ms } = await sb.from('incoming_missions')
    .select('id, status, vehicle_plate, incident_lat, incident_lng, destination_lat, destination_lng, destination_name, destination_address, on_site_at, loaded_at, mission_type, paused_at')
    .eq('assigned_to', userId).in('status', ['in_progress', 'delivering'])
  for (const m of ms || []) {
    if (m.paused_at) continue
    const kind = m.status === 'in_progress' && !m.on_site_at && !/relivraison/i.test(String(m.mission_type || '')) ? 'sur_place'
      : m.status === 'delivering' && m.loaded_at ? 'dest' : null
    if (!kind) continue
    const cible = kind === 'sur_place' ? [m.incident_lat, m.incident_lng] : [m.destination_lat, m.destination_lng]
    if (cible[0] == null || cible[1] == null) continue
    const d = distanceM({ lat, lng }, { lat: Number(cible[0]), lng: Number(cible[1]) })
    if (d > (kind === 'sur_place' ? 200 : 150)) continue
    const { data: deja } = await sb.from('mission_logs').select('id').eq('mission_id', m.id).eq('action', 'arrivee_proposee').contains('metadata', { kind }).limit(1)
    if (deja?.length) continue
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: userId, action: 'arrivee_proposee', notes: `Position à ${Math.round(d)} m ${kind === 'sur_place' ? 'de l’intervention' : 'de la destination'} : pointage proposé au chauffeur`, metadata: { kind, distance_m: Math.round(d) } })
    const ou = kind === 'dest' ? (m.destination_name || String(m.destination_address || '').split(',')[0]) : ''
    const { sendNotification } = await import('@/lib/notifications/send')
    await sendNotification(userId, 'mission_arrivee_proche', {
      title: kind === 'sur_place'
        ? (lang === 'sq' ? 'Duket se po mbërrin në vend' : 'Il semblerait que tu arrives sur place')
        : (lang === 'sq' ? `Duket se po mbërrin${ou ? ` te ${ou}` : ' në destinacion'}` : `Il semblerait que tu arrives${ou ? ` chez ${ou}` : ' à destination'}`),
      body: `${m.vehicle_plate || ''} · ${lang === 'sq' ? 'Prek për të pointuar.' : 'Touche pour pointer.'}`,
      action_url: `/mission/${m.id}`, mission_id: m.id,
    })
  }
}
