// src/app/api/relivraison/list/route.ts
//
// Liste du module Relivraison : véhicules parkés dans une zone de type
// 'relivraison' (onglets K / SNC), parents avec REL enfant active exclus,
// triés par tournée (plus proche voisin depuis le dépôt). Olivier 2026-06-22.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SELECT = `id, mission_number, external_id, source, mission_type, incident_type,
  client_name, vehicle_plate, vehicle_brand, vehicle_model,
  redelivery_address, redelivery_lat, redelivery_lng,
  parc_zone_key, received_at, intervention_date, status, garage_reopen_date`

const DEPOT = { lat: 50.5703357, lng: 5.8216501 } // Pepinster (dépôt par défaut)

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { searchParams } = new URL(req.url)

  // Onglets = zones de type 'relivraison' (K, SNC, ...).
  const { data: ztRows } = await sb
    .from('parc_zones')
    .select('key, label, sort_order')
    .eq('zone_type', 'relivraison')
    .eq('active', true)
    .order('sort_order')
  const relZones = ztRows || []
  const relKeys  = relZones.map(z => z.key)

  // Zone demandée (défaut K).
  let zone = searchParams.get('zone') || 'K'
  if (!relKeys.includes(zone)) zone = relKeys.includes('K') ? 'K' : (relKeys[0] || 'K')

  const stdFilters = (q: any) => q
    .not('external_id', 'like', 'PROCESSING_%')
    .not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
    .is('archived_at', null)

  // Compteurs par zone (badge onglet) — brut (peut inclure quelques parents reliés).
  const counts: Record<string, number> = {}
  await Promise.all(relZones.map(async z => {
    const { count } = await stdFilters(
      sb.from('incoming_missions').select('*', { count: 'exact', head: true })
        .eq('status', 'parked').eq('parc_zone_key', z.key)
    )
    counts[z.key] = count || 0
  }))

  // Missions de la zone active.
  const { data: rows, error } = await stdFilters(
    sb.from('incoming_missions').select(SELECT)
      .eq('status', 'parked').eq('parc_zone_key', zone)
      .order('intervention_date', { ascending: false, nullsFirst: false })
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let missions = rows || []

  // Exclure les parents ayant déjà une REL enfant active.
  const ids = missions.map((m: any) => m.id)
  if (ids.length > 0) {
    const { data: kids } = await sb
      .from('incoming_missions')
      .select('parent_mission_id')
      .in('parent_mission_id', ids)
      .not('status', 'in', '("cancelled","ignored")')
    const withChild = new Set((kids || []).map((k: any) => k.parent_mission_id).filter(Boolean))
    missions = missions.filter((m: any) => !withChild.has(m.id))
  }

  // Tri par tournée (plus proche voisin depuis le dépôt) sur coords en cache.
  if (missions.length > 1) {
    const dist = (a: any, b: any) => {
      const dLat = a.lat - b.lat
      const dLng = (a.lng - b.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
      return dLat * dLat + dLng * dLng
    }
    const has = (m: any) => m.redelivery_lat != null && m.redelivery_lng != null
    const pool = missions.filter(has)
    const without = missions.filter((m: any) => !has(m))
    const ordered: any[] = []
    let cursor = DEPOT
    while (pool.length) {
      let bi = 0, bd = Infinity
      for (let i = 0; i < pool.length; i++) {
        const c = { lat: Number(pool[i].redelivery_lat), lng: Number(pool[i].redelivery_lng) }
        const d = dist(cursor, c)
        if (d < bd) { bd = d; bi = i }
      }
      const n = pool.splice(bi, 1)[0]
      ordered.push(n)
      cursor = { lat: Number(n.redelivery_lat), lng: Number(n.redelivery_lng) }
    }
    missions = [...ordered, ...without]
  }

  return NextResponse.json({
    zone,
    zones: relZones.map(z => ({ key: z.key, label: z.label, count: counts[z.key] || 0 })),
    missions,
  })
}
