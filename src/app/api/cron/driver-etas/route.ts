// src/app/api/cron/driver-etas/route.ts
//
// Calcule l'ETA live du chauffeur assigné vers son prochain point, pour affichage
// sur le dispatch. 100 % gratuit : GPS chauffeur (pings 30s, users.last_location_*)
// + OpenRouteService (lib/routing/ors). Stocke driver_eta_minutes + driver_eta_at.
//
// Cible par statut :
//   - en route vers l'incident (assigned/accepted/on_way/on_site) → incident
//   - vers la destination (in_progress/delivering)               → destination si connue
//
// Garde-fous ORS : seulement les missions dont la position chauffeur est FRAÎCHE
// (< 3 min) et cap sur le nb d'appels par passe. Olivier 2026-07-28.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getDrivingRoute }   from '@/lib/routing/ors'

export const dynamic     = 'force-dynamic'
export const maxDuration  = 60

const ACTIVE = ['assigned', 'accepted', 'on_way', 'on_site', 'in_progress', 'delivering']
const POSITION_FRESH_MS = 3 * 60 * 1000    // position chauffeur < 3 min
const MAX_ORS_CALLS     = 40                // borne dure par passe (protège le quota ORS)

/** Cap camion : vitesse moyenne bornée à 90 km/h. */
function truckCapMinutes(r: { minutes: number; km: number }): number {
  const hours = r.minutes / 60
  const avg = hours > 0 ? r.km / hours : 0
  return avg > 90 ? Math.round((r.km / 90) * 60) : r.minutes
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb  = createAdminClient()
  const now = Date.now()

  const { data: missions, error } = await sb
    .from('incoming_missions')
    .select('id, status, assigned_to, incident_lat, incident_lng, destination_lat, destination_lng')
    .in('status', ACTIVE)
    .not('assigned_to', 'is', null)
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Positions des chauffeurs assignés.
  const driverIds = [...new Set((missions || []).map(m => m.assigned_to).filter(Boolean))] as string[]
  const posById = new Map<string, { lat: number; lng: number; age: number }>()
  if (driverIds.length) {
    const { data: drivers } = await sb
      .from('users').select('id, last_location_lat, last_location_lng, location_updated_at').in('id', driverIds)
    for (const d of drivers || []) {
      if (d.last_location_lat == null || d.last_location_lng == null) continue
      const age = d.location_updated_at ? now - new Date(d.location_updated_at).getTime() : Infinity
      posById.set(d.id, { lat: Number(d.last_location_lat), lng: Number(d.last_location_lng), age })
    }
  }

  let computed = 0, skipped = 0
  for (const m of missions || []) {
    if (computed >= MAX_ORS_CALLS) break
    const pos = m.assigned_to ? posById.get(m.assigned_to) : null
    // Cible : destination si en cours de livraison, sinon incident.
    const toDest = ['in_progress', 'delivering'].includes(m.status) && m.destination_lat != null && m.destination_lng != null
    const target = toDest
      ? { lat: Number(m.destination_lat), lng: Number(m.destination_lng) }
      : (m.incident_lat != null && m.incident_lng != null ? { lat: Number(m.incident_lat), lng: Number(m.incident_lng) } : null)

    if (!pos || pos.age > POSITION_FRESH_MS || !target) {
      // Position périmée / pas de cible → on ne (re)calcule pas. L'affichage
      // ignore les ETA dont driver_eta_at n'est plus frais (pas de stale montré).
      skipped++
      continue
    }
    try {
      const r = await getDrivingRoute(pos, target)
      const mins = truckCapMinutes(r)
      await sb.from('incoming_missions').update({ driver_eta_minutes: mins, driver_eta_at: new Date().toISOString() }).eq('id', m.id)
      computed++
    } catch (e: any) {
      console.warn('[driver-etas] ORS KO mission', m.id, e?.message)
      skipped++
    }
  }

  return NextResponse.json({ ok: true, computed, skipped, total: (missions || []).length })
}
