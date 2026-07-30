// src/app/api/cron/estimate-police-trips/route.ts
//
// Remplit est_trip_min sur les missions APPEL POLICE sans pointage : durée par
// défaut = trajet A/R Dépôt → intervention → Dépôt (ORS) + 20 min. Sert de
// « temps de traitement » pour ces fiches dans les moyennes du tableau de bord
// (sinon assignation→clôture = plusieurs jours). Idempotent : est_trip_min IS
// NULL uniquement. Petits lots (ORS rate-limité). Olivier 2026-07-30.

import { NextResponse }        from 'next/server'
import { createAdminClient }   from '@/lib/supabase'
import { loadDepots, estimatePoliceTripMin } from '@/lib/perf/police-trip'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const BATCH = 20         // borné : ORS ~40 req/min
const LOOKBACK_DAYS = 60 // on ne remonte pas indéfiniment

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400e3).toISOString()

  // Missions police, sans pointage (on_way_at null), avec coords, sans estimation.
  const { data: missions } = await sb.from('incoming_missions')
    .select('id, source, on_way_at, incident_lat, incident_lng, departure_depot_id, depot_depart_id')
    .like('source', 'police\\_%')
    .is('on_way_at', null)
    .is('est_trip_min', null)
    .not('incident_lat', 'is', null)
    .not('assigned_to', 'is', null)
    .gte('assigned_at', since)
    .limit(BATCH)

  if (!missions?.length) return NextResponse.json({ ok: true, filled: 0, note: 'rien à estimer' })

  const depots = await loadDepots(sb)
  let filled = 0
  for (const m of missions) {
    try {
      const min = await estimatePoliceTripMin(m, depots)
      if (min == null) continue
      await sb.from('incoming_missions').update({ est_trip_min: min }).eq('id', m.id)
      filled++
    } catch (e: any) {
      console.warn('[estimate-police-trips]', m.id, e?.message)
    }
  }
  return NextResponse.json({ ok: true, filled, scanned: missions.length })
}
