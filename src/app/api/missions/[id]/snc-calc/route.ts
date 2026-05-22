// src/app/api/missions/[id]/snc-calc/route.ts
//
// POST /api/missions/[id]/snc-calc
//   Calcule les metrics SNC (depot de depart, km depanneuse, km balisage,
//   majoration horaire) pour une mission SNC. Sauve dans incoming_missions
//   (snc_depart_depot, snc_km_total, snc_km_balisage).
//
//   Utilise Google Maps Distance Matrix + table depots.
//
//   Body optionnel : { force_recompute?: boolean }
//
// Acces : admin / superadmin / module facturation ou fourriere.

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { computeSncMetrics }       from '@/lib/snc/pricing'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('facturation') ||
    modules.includes('fourriere')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const missionId = String(params.id || '').trim()
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select(`
      id, source, snc_scenario, snc_requires_balisage,
      incident_lat, incident_lng, destination_lat, destination_lng,
      intervention_date, received_at
    `)
    .eq('id', missionId)
    .maybeSingle()
  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (mission.source !== 'police_snc') {
    return NextResponse.json({ error: `Mission n est pas SNC (source=${mission.source})` }, { status: 409 })
  }
  if (!mission.snc_scenario) {
    return NextResponse.json({ error: 'snc_scenario manquant sur la mission' }, { status: 400 })
  }

  const metrics = await computeSncMetrics({
    scenario:          mission.snc_scenario as any,
    requiresBalisage:  Boolean(mission.snc_requires_balisage),
    interventionLat:   mission.incident_lat,
    interventionLng:   mission.incident_lng,
    destinationLat:    (mission as any).destination_lat,
    destinationLng:    (mission as any).destination_lng,
    interventionAt:    mission.intervention_date || mission.received_at,
  })

  if (!metrics) {
    return NextResponse.json({
      error: 'Impossible de calculer les métriques (coordonnées intervention manquantes ou pas de dépôts configurés)',
    }, { status: 400 })
  }

  // Sauve dans la mission
  const { error: upErr } = await sb
    .from('incoming_missions')
    .update({
      snc_depart_depot: metrics.depart_depot.toLowerCase().includes('pepinster') ? 'pepinster'
                       : metrics.depart_depot.toLowerCase().includes('aywaille') ? 'aywaille'
                       : null,
      snc_km_total:     metrics.km_depanneuse,
      snc_km_balisage:  metrics.km_balisage,
      updated_at:       new Date().toISOString(),
    })
    .eq('id', missionId)
  if (upErr) {
    console.error('[snc-calc] update echec:', upErr.message)
    // Non bloquant : on retourne quand meme les metrics
  }

  return NextResponse.json({ ok: true, metrics })
}
