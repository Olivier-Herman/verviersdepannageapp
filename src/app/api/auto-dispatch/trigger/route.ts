// src/app/api/auto-dispatch/trigger/route.ts
//
// POST /api/auto-dispatch/trigger { mission_id }
//
// Declenche l'auto-dispatch sequentiel sur une mission.
// Accessible aux users avec module 'auto_dispatch' actif ou role admin/superadmin/dispatcher.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { startAttempt }      from '@/lib/auto-dispatch/orchestrator'
import { isRemorquage, isDsp } from '@/lib/missions/mission-types'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const role   = (session.user as any).role || ''
  const modules = (session.user as any).modules || []

  const allowed = ['admin', 'superadmin', 'dispatcher'].includes(role) || modules.includes('auto_dispatch')
  if (!allowed) return NextResponse.json({ error: 'Permission auto_dispatch requise' }, { status: 403 })

  const body = await req.json() as { mission_id?: string }
  if (!body.mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const sb = createAdminClient()

  // 1. Fetch mission
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('id, mission_type, dossier_number, incident_address, incident_city, incident_lat, incident_lng, status, assigned_to')
    .eq('id', body.mission_id)
    .maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // 2. Filtre type mission (insensible casse + alias REM/DSP/reparation_place)
  if (!isRemorquage(mission.mission_type) && !isDsp(mission.mission_type)) {
    return NextResponse.json({
      error: `Auto-dispatch reserve aux REM/DSP. Type recu: ${mission.mission_type}`,
    }, { status: 400 })
  }

  // 3. Mission deja assignee ?
  if (mission.assigned_to) {
    return NextResponse.json({ error: 'Mission deja assignee' }, { status: 409 })
  }

  // 3.5. Geocoder l'adresse incident si pas encore fait (pour /driver-eta).
  // Permet de declencher l'auto-dispatch sur une mission 'new' non encore
  // confirmee par le dispatcher.
  if (mission.incident_lat == null || mission.incident_lng == null) {
    const addr = mission.incident_address || ''
    if (!addr.trim()) {
      return NextResponse.json({ error: 'Mission sans adresse d\'incident — impossible de calculer les ETA chauffeur' }, { status: 400 })
    }
    const key = process.env.GOOGLE_GEOCODING || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!key) {
      return NextResponse.json({ error: 'Google Geocoding API non configure' }, { status: 500 })
    }
    try {
      const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${key}&language=fr&region=be`)
      const geo = await geoRes.json()
      const loc = geo?.results?.[0]?.geometry?.location
      if (!loc?.lat || !loc?.lng) {
        return NextResponse.json({ error: `Geocoding echec pour: ${addr}` }, { status: 400 })
      }
      await sb.from('incoming_missions').update({
        incident_lat: loc.lat,
        incident_lng: loc.lng,
      }).eq('id', mission.id)
      // Update in-memory pour les etapes suivantes
      ;(mission as any).incident_lat = loc.lat
      ;(mission as any).incident_lng = loc.lng
    } catch (e: any) {
      return NextResponse.json({ error: `Geocoding fetch error: ${e.message}` }, { status: 500 })
    }
  }

  // 4. Tentative deja en cours ?
  const { data: existing } = await sb
    .from('dispatch_attempts_log')
    .select('id, status, driver_id')
    .eq('mission_id', mission.id)
    .in('status', ['pending', 'push_sent', 'call_1_sent', 'call_2_sent'])
    .limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'Auto-dispatch deja en cours sur cette mission', attempt_id: existing[0].id }, { status: 409 })
  }

  // 5. Appelle l'API driver-eta interne pour avoir la liste ordonnee
  const baseUrl = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
  const cookieHeader = req.headers.get('cookie') || ''
  const etaRes = await fetch(`${baseUrl}/api/missions/${mission.id}/driver-eta`, {
    headers: { cookie: cookieHeader },
  })
  if (!etaRes.ok) {
    return NextResponse.json({ error: `Echec driver-eta: ${etaRes.status}` }, { status: 500 })
  }
  const etaData = await etaRes.json() as {
    drivers: Array<{
      id: string
      name: string
      status: 'free' | 'on_mission'
      eta_total_min: number | null
      priority_order: number | null
    }>
    best_eta_min: number | null
    tolerance_min: number
  }

  // 6. Construit l'ordre selon scenario : sous-groupe ETA <= best+tolerance, trie par priority_order
  //    Les chauffeurs sans ETA ne sont pas eligibles a l'auto-dispatch
  const candidates = etaData.drivers.filter(d => d.eta_total_min != null)
  if (candidates.length === 0) {
    return NextResponse.json({ error: 'Aucun chauffeur disponible' }, { status: 503 })
  }

  // 7. Recupere les phones des candidats
  const driverIds = candidates.map(d => d.id)
  const { data: phonesData } = await sb
    .from('users')
    .select('id, phone')
    .in('id', driverIds)
  const phoneById = new Map((phonesData || []).map(p => [p.id, p.phone as string | null]))

  // 8. Lance C1 (le premier de la liste)
  const c1 = candidates[0]
  const missionLabel = `Mission ${mission.dossier_number || mission.id.slice(0, 8)}${mission.incident_city ? ' — ' + mission.incident_city : ''}`

  const res = await startAttempt({
    missionId:    mission.id,
    driverId:     c1.id,
    attemptOrder: 1,
    driverPhone:  phoneById.get(c1.id) || null,
    driverName:   c1.name,
    isInMission:  c1.status === 'on_mission',
    triggeredBy:  userId,
    missionLabel,
  })

  // 9. Mark mission as dispatching
  await sb.from('incoming_missions').update({
    status:     'dispatching',
    updated_at: new Date().toISOString(),
  }).eq('id', mission.id)

  return NextResponse.json({
    ok: res.ok,
    attempt_id: res.attemptId,
    target_driver: { id: c1.id, name: c1.name },
    error: res.error,
  })
}
