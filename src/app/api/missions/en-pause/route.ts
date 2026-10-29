// GET /api/missions/en-pause — missions remises au dispatch en pause, visibles par TOUS les chauffeurs
// (Olivier 29/10/2026, maquette validée) ; triées par heure de reprise, distance depuis la dernière position du chauffeur.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const km = (a: [number, number], b: [number, number]) => {
  const R = 6371, rad = (d: number) => d * Math.PI / 180
  const s = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))) * 1.3)   // routes ≈ vol d'oiseau × 1,3
}

export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const sb = createAdminClient()
  const { data: u } = await sb.from('users').select('id, active, last_location_lat, last_location_lng').eq('email', email).maybeSingle()
  if (!u?.active) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, source, mission_type, vehicle_plate, vehicle_brand, vehicle_model, incident_address, incident_city, incident_lat, incident_lng, pause_until, pause_reason, pause_released_at, released_by:users!pause_released_by(name)')
    .not('pause_released_at', 'is', null).is('assigned_to', null).eq('status', 'dispatching')
    .order('pause_until', { ascending: true }).limit(50)
  const pos: [number, number] | null = u.last_location_lat != null && u.last_location_lng != null ? [Number(u.last_location_lat), Number(u.last_location_lng)] : null
  const missions = (data || []).map((m: any) => ({
    ...m, released_by: m.released_by?.name || null,
    km: pos && m.incident_lat != null && m.incident_lng != null ? km(pos, [Number(m.incident_lat), Number(m.incident_lng)]) : null,
  }))
  return NextResponse.json({ missions })
}
