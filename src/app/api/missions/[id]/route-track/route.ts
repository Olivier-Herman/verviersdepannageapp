// src/app/api/missions/[id]/route-track/route.ts
//
// Renvoie le trajet GPS d'une mission pour la carte dispatch :
//   - pings   : toutes les positions (kind='ping') ordonnées = le tracé
//   - points  : les lieux de pointage (kind=action) = marqueurs
//   - incident: lat/lng du lieu d'intervention (référence)
//
// Lecture seule, réservée au staff (dispatcher/admin/superadmin/fourrière).
// Olivier 2026-06-16.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['admin', 'superadmin', 'dispatcher']
function canAccess(session: any): boolean {
  if (!session) return false
  const role = (session.user as any)?.role || ''
  const modules: string[] = (session.user as any)?.modules || []
  return ALLOWED_ROLES.includes(role) || modules.includes('fourriere')
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()

  const { data: rows, error } = await sb
    .from('mission_position_pings')
    .select('lat, lng, kind, recorded_at, address')
    .eq('mission_id', params.id)
    .order('recorded_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: mission } = await sb
    .from('incoming_missions')
    .select('incident_lat, incident_lng, incident_address, destination_lat, destination_lng, destination_address')
    .eq('id', params.id)
    .single()

  const all     = rows || []
  const pings   = all.filter(r => r.kind === 'ping')
  const points  = all.filter(r => r.kind !== 'ping')

  // ── Distances ROUTIÈRES (Olivier 2026-08-14) ────────────────────────────
  // « À vol d'oiseau c'est très proche, il faut le faire en route réelle » :
  // à Verviers, un garage et notre dépôt peuvent être à 800 m l'un de l'autre
  // en ligne droite et à plusieurs kilomètres par la route. Un rayon d'un
  // kilomètre à vol d'oiseau ne prouve donc rien.
  // Calculé À LA DEMANDE (?road=1) et en DEUX requêtes matricielles, pas une par
  // point : la carte, elle, n'en a pas besoin et ne doit pas ralentir.
  let road: { toIncident: (number | null)[]; toDestination: (number | null)[] } | null = null
  if (new URL(_req.url).searchParams.get('road') === '1' && points.length > 0) {
    try {
      const { getDrivingMatrix } = await import('@/lib/routing/ors')
      const origins = points.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }))
      const inc = mission?.incident_lat != null && mission?.incident_lng != null
        ? await getDrivingMatrix(origins, { lat: Number(mission.incident_lat), lng: Number(mission.incident_lng) })
        : null
      const dst = mission?.destination_lat != null && mission?.destination_lng != null
        ? await getDrivingMatrix(origins, { lat: Number(mission.destination_lat), lng: Number(mission.destination_lng) })
        : null
      road = {
        toIncident:    origins.map((_, i) => inc?.[i]?.km ?? null),
        toDestination: origins.map((_, i) => dst?.[i]?.km ?? null),
      }
    } catch { /* ORS indisponible → le tableau reste lisible sans les distances */ }
  }

  return NextResponse.json({
    pings,
    points,
    road,
    incident: mission?.incident_lat != null && mission?.incident_lng != null
      ? { lat: Number(mission.incident_lat), lng: Number(mission.incident_lng), address: mission.incident_address || '' }
      : null,
    destination: mission?.destination_lat != null && mission?.destination_lng != null
      ? { lat: Number(mission.destination_lat), lng: Number(mission.destination_lng), address: mission.destination_address || '' }
      : null,
  })
}
