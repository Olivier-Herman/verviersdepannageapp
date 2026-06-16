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
    .select('lat, lng, kind, recorded_at')
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

  return NextResponse.json({
    pings,
    points,
    incident: mission?.incident_lat != null && mission?.incident_lng != null
      ? { lat: Number(mission.incident_lat), lng: Number(mission.incident_lng), address: mission.incident_address || '' }
      : null,
    destination: mission?.destination_lat != null && mission?.destination_lng != null
      ? { lat: Number(mission.destination_lat), lng: Number(mission.destination_lng), address: mission.destination_address || '' }
      : null,
  })
}
