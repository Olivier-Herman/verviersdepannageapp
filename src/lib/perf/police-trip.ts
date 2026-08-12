// src/lib/perf/police-trip.ts
//
// Durée « par défaut » attribuée aux missions APPEL POLICE sans pointage
// (pas de on_way_at → on ne peut pas mesurer le temps réel du chauffeur).
// Valeur = trajet aller-retour Dépôt → intervention → Dépôt (routier, ORS)
// + 20 min sur place. Le dépôt est celui de la fiche (departure_depot_id /
// depot_depart_id) sinon le dépôt par défaut (Pepinster). Olivier 2026-07-30.

import { getDrivingRoute } from '@/lib/routing/ors'

const ON_SITE_MIN = 20

export interface DepotCoord { id: string; lat: number; lng: number; is_default: boolean }

// Vraie « mission appel police » sans pointage : source police_* et pas de
// on_way_at (le chauffeur n'a jamais pointé « en route »).
export function isPoliceNoPointage(m: any): boolean {
  return typeof m?.source === 'string' && m.source.startsWith('police_') && !m.on_way_at
}

// Charge les dépôts (une fois) : map par id + dépôt par défaut.
export async function loadDepots(sb: any): Promise<{ byId: Map<string, DepotCoord>; def: DepotCoord | null }> {
  const { data } = await sb.from('depots').select('id, lat, lng, is_default').eq('active', true)
  const byId = new Map<string, DepotCoord>()
  let def: DepotCoord | null = null
  for (const d of (data || [])) {
    if (d.lat == null || d.lng == null) continue
    const c: DepotCoord = { id: d.id, lat: Number(d.lat), lng: Number(d.lng), is_default: !!d.is_default }
    byId.set(d.id, c)
    if (c.is_default) def = c
  }
  return { byId, def }
}

function depotOf(m: any, depots: { byId: Map<string, DepotCoord>; def: DepotCoord | null }): DepotCoord | null {
  const id = m.departure_depot_id || m.depot_depart_id || null
  return (id && depots.byId.get(id)) || depots.def
}

// Calcule la durée par défaut (min) pour une fiche police sans pointage.
// Renvoie null si coords incident ou dépôt manquants (→ exclue du calcul).
export async function estimatePoliceTripMin(
  m: any,
  depots: { byId: Map<string, DepotCoord>; def: DepotCoord | null },
): Promise<number | null> {
  if (m.incident_lat == null || m.incident_lng == null) return null
  const depot = depotOf(m, depots)
  if (!depot) return null
  const leg = await getDrivingRoute(
    { lat: depot.lat, lng: depot.lng },
    { lat: Number(m.incident_lat), lng: Number(m.incident_lng) },
    // Durée « perf » (temps réaliste du chauffeur) → le plus RAPIDE, pas le plus
    // court. (Le « shortest » ne concerne que la distance FACTURÉE.) + repli Google.
    { googleFallback: true },
  )
  // Aller-retour = 2 × trajet dépôt→intervention, + temps sur place.
  return Math.round(leg.minutes * 2 + ON_SITE_MIN)
}
