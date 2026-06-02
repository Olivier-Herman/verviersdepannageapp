// src/app/api/snc-preview-tarif/route.ts
//
// POST /api/snc-preview-tarif
// Body : {
//   scenario:          'dsp' | 'rem_client' | 'rem_depot' | 'rem_direct',
//   requires_balisage: boolean,
//   incident_lat, incident_lng,
//   destination_lat?, destination_lng?,
//   intervention_at:   ISO date,
// }
//
// Preview du tarif SNC en temps reel pour affichage cote chauffeur (DSP/REM client
// pour encaissement immediat). Ne sauve rien : juste calcul.
//
// Acces : tout user authentifie (chauffeur)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { computeSncMetrics, buildSncQuoteLines } from '@/lib/snc/pricing'

export const dynamic     = 'force-dynamic'
export const maxDuration = 15

const TVA_RATE = 0.21

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const scenario = String(body.scenario || '').trim() as 'dsp' | 'rem_client' | 'rem_depot' | 'rem_direct'
  if (!['dsp', 'rem_client', 'rem_depot', 'rem_direct'].includes(scenario)) {
    return NextResponse.json({ error: 'scenario invalide' }, { status: 400 })
  }
  const variant = body.variant === 'sc' ? 'sc' : 'snc'
  const requiresBalisage = Boolean(body.requires_balisage)
  const interventionLat = body.incident_lat != null ? Number(body.incident_lat) : null
  const interventionLng = body.incident_lng != null ? Number(body.incident_lng) : null
  const destinationLat  = body.destination_lat != null ? Number(body.destination_lat) : null
  const destinationLng  = body.destination_lng != null ? Number(body.destination_lng) : null
  const interventionAt  = body.intervention_at || new Date().toISOString()
  // SC + rem_direct : identifie l assistance facturee pour resolution du
  // tarif km via mission_source_catalog.default_billed_to_id
  const billedToId      = body.billed_to_id != null ? Number(body.billed_to_id) : null
  const billedToName    = typeof body.billed_to_name === 'string' ? body.billed_to_name : null

  if (interventionLat == null || interventionLng == null) {
    return NextResponse.json({
      ok:        false,
      error:     'Coordonnées intervention manquantes (saisir le lieu via l autocomplete Google).',
    }, { status: 400 })
  }
  if ((scenario === 'rem_client' || scenario === 'rem_direct')
      && (destinationLat == null || destinationLng == null)) {
    return NextResponse.json({
      ok:        false,
      error:     'Coordonnées destination manquantes (saisir la destination via l autocomplete Google).',
    }, { status: 400 })
  }

  // Stops chauffeur (extra_addresses) passes par le client (deja ordonnes)
  const stops = Array.isArray(body.stops)
    ? body.stops.map((s: any) => ({
        lat:   s.lat != null ? Number(s.lat) : null,
        lng:   s.lng != null ? Number(s.lng) : null,
        label: s.label || s.address || 'Stop',
      }))
    : []

  const metrics = await computeSncMetrics({
    scenario, requiresBalisage,
    interventionLat, interventionLng,
    destinationLat, destinationLng,
    interventionAt,
    variant,
    billedToId, billedToName,
    stops,
  })

  if (!metrics) {
    return NextResponse.json({
      ok: false,
      error: 'Impossible de calculer (dépôts non configurés ou coordonnées invalides)',
    }, { status: 400 })
  }

  const lines = buildSncQuoteLines({ metrics, requiresBalisage, missionRef: 'PREVIEW', variant })
  const totalHtva = lines.reduce((s, l) => s + l.qty * l.price_unit, 0)
  const totalTvac = Math.round(totalHtva * (1 + TVA_RATE) * 100) / 100

  return NextResponse.json({
    ok:         true,
    metrics,
    lines,
    total_htva: Math.round(totalHtva * 100) / 100,
    total_tvac: totalTvac,
    tva_rate:   TVA_RATE,
  })
}
