// src/app/api/relivraison/list/route.ts
//
// Liste du module Relivraison : véhicules parkés dans une zone de type
// 'relivraison' (onglets K / SNC), parents avec REL enfant active exclus,
// triés par tournée (plus proche voisin depuis le dépôt). Olivier 2026-06-22.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPreviewOn }       from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

const SELECT = `id, mission_number, external_id, source, mission_type, incident_type,
  client_name, client_phone, assisted_phone, billed_to_name, vehicle_plate, vehicle_brand, vehicle_model,
  redelivery_address, redelivery_lat, redelivery_lng,
  parc_zone_key, parked_at, received_at, intervention_date, status, garage_reopen_date`


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
    .eq('dossier_leg', false)   // miroirs gardiennage (Vue dossier) : jamais à relivrer
    .not('external_id', 'like', 'PROCESSING_%')
    .not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
    .is('archived_at', null)

  // Compteurs par zone (badge onglet) = ce que l'onglet AFFICHE : les fiches
  // dont la relivraison existe déjà (en cours ou terminée) n'y sont plus.
  // Olivier 09/09/2026 : « ça dit 7 mais ça affiche deux » — le compteur
  // comptait tout ce qui était garé en K, l'onglet cachait 5 fiches dont la
  // relivraison était faite depuis des semaines (fiche remise en parc à la main).
  const counts: Record<string, number> = {}
  await Promise.all(relZones.map(async z => {
    const { data: parkedIds } = await stdFilters(
      sb.from('incoming_missions').select('id').eq('status', 'parked').eq('parc_zone_key', z.key)
    )
    const ids: string[] = (parkedIds || []).map((r: any) => String(r.id))
    if (!ids.length) { counts[z.key] = 0; return }
    const { data: kids } = await sb.from('incoming_missions').select('parent_mission_id')
      .in('parent_mission_id', ids).eq('dossier_leg', false).not('status', 'in', '("cancelled","ignored")')
    const withChild = new Set((kids || []).map((k: any) => k.parent_mission_id))
    counts[z.key] = ids.filter(id => !withChild.has(id)).length
  }))

  // Missions de la zone active.
  // Bascule Fourrière (flag fourriere_gardiennage) : la zone se lit sur les
  // fiches GARDIENNAGE ouvertes ; les actions gardent l'id de la racine.
  const gardiennageMode = await isPreviewOn('fourriere_gardiennage', (session.user as any)?.role, (session.user as any)?.id)
  let rows: any[] | null = null, error: any = null
  if (gardiennageMode) {
    const { data: legs } = await sb.from('incoming_missions').select('parent_mission_id')
      .eq('dossier_leg', true).is('parc_exit_at', null).eq('parc_zone_key', zone)
    const rootIds = Array.from(new Set((legs || []).map((l: any) => l.parent_mission_id).filter(Boolean)))
    if (rootIds.length) {
      const r = await stdFilters(sb.from('incoming_missions').select(SELECT).in('id', rootIds)
        .order('intervention_date', { ascending: false, nullsFirst: false }))
      rows = r.data; error = r.error
    } else rows = []
  } else {
    const r = await stdFilters(
      sb.from('incoming_missions').select(SELECT)
        .eq('status', 'parked').eq('parc_zone_key', zone)
        .order('intervention_date', { ascending: false, nullsFirst: false })
    )
    rows = r.data; error = r.error
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let missions = rows || []

  // Les parents qui ont déjà une relivraison ne sont plus « à relivrer » :
  //  - relivraison EN COURS (à assigner / assignée / en route…) → groupe « en cours »,
  //    affiché en dessous, sans bouton : on sait où en est le véhicule ;
  //  - relivraison TERMINÉE mais fiche encore « en parc » → incohérence (véhicule
  //    parti, fiche remise en parc à la main) → groupe « à sortir du parc », avec
  //    le bouton qui régularise. Olivier 09/09/2026.
  const ids = missions.map((m: any) => m.id)
  const pending: any[] = [], stale: any[] = []
  if (ids.length > 0) {
    const { data: kids } = await sb
      .from('incoming_missions')
      .select('id, parent_mission_id, mission_number, status, assigned_to, completed_at, created_at')
      .in('parent_mission_id', ids)
      .eq('dossier_leg', false)   // fiches Gardiennage ≠ REL (08/09/2026)
      .not('status', 'in', '("cancelled","ignored")')
      .order('created_at', { ascending: false })
    const driverIds = Array.from(new Set((kids || []).map((k: any) => k.assigned_to).filter(Boolean)))
    const names: Record<string, string> = {}
    if (driverIds.length) {
      const { data: us } = await sb.from('users').select('id, name').in('id', driverIds)
      for (const u of (us || []) as any[]) names[u.id] = u.name
    }
    const byParent = new Map<string, any>()
    for (const k of (kids || []) as any[]) if (!byParent.has(k.parent_mission_id)) byParent.set(k.parent_mission_id, k)
    const DONE = new Set(['completed', 'to_invoice', 'invoiced'])
    const rest: any[] = []
    for (const m of missions) {
      const k = byParent.get(m.id)
      if (!k) { rest.push(m); continue }
      const rel = { id: k.id, mission_number: k.mission_number, status: k.status, driver: k.assigned_to ? (names[k.assigned_to] || null) : null, completed_at: k.completed_at, created_at: k.created_at }
      if (DONE.has(k.status)) stale.push({ ...m, rel }); else pending.push({ ...m, rel })
    }
    missions = rest
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
    // Point de départ de la tournée = parc par défaut (table depots), plus de coordonnées codées.
    const { data: depotRow } = await sb.from('depots').select('lat, lng').eq('active', true).or('is_default_parc.eq.true,is_default.eq.true').order('is_default_parc', { ascending: false }).limit(1).maybeSingle()
    if (!depotRow?.lat || !depotRow?.lng) return NextResponse.json({ error: 'Aucun dépôt par défaut avec coordonnées dans la table des dépôts.' }, { status: 500 })
    let cursor = { lat: Number(depotRow.lat), lng: Number(depotRow.lng) }
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
    pending,
    stale,
    source: gardiennageMode ? 'gardiennage' : 'vd_soft',
  })
}
