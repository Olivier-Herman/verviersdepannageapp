// Recherche véhicule pour la borne visiteur : propose les fiches VD Soft par
// plaque / n° de dossier. Protégé par géofence (présence à l'accueil) + durci
// (min 5 caractères de plaque, match plaque, pas d'énumération par préfixe).
// GET /api/reception/vehicle-search?q=1ABC234&lat=..&lng=..

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { withinGeofence }            from '@/lib/reception/geofence'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const normPlate = (p: string) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sb = createAdminClient()

  // Staff connecté (console réception) : pas de géofence. Sinon (borne visiteur) :
  // présence physique requise.
  const session = await getServerSession(authOptions)
  if (!session && !await withinGeofence(sb, searchParams.get('lat'), searchParams.get('lng'))) {
    return NextResponse.json({ results: [], reason: 'geo' }, { status: 403 })
  }

  const raw   = (searchParams.get('q') || '').trim()
  const pk    = normPlate(raw)
  const clean = raw.replace(/[^A-Za-z0-9-]/g, '')
  // Anti-énumération : au moins 5 caractères de plaque significatifs.
  if (pk.length < 5) return NextResponse.json({ results: [] })

  const RANK: Record<string, number> = { parked: 6, to_invoice: 5, delivering: 4, in_progress: 3, accepted: 2, completed: 1 }
  const parts = [`vehicle_plate.ilike.%${clean}%`, `external_id.ilike.%${clean}%`, `dossier_number.ilike.%${clean}%`]
  if (/^\d+$/.test(clean)) parts.push(`mission_number.eq.${clean}`)

  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, status, parc_zone_key, external_id, dossier_number, created_at')
    .or(parts.join(','))
    .not('status', 'in', '(cancelled,ignored,parse_error)')
    .order('created_at', { ascending: false })
    .limit(60)

  // Ne garde que les vraies correspondances (plaque contient la saisie, ou réf exacte).
  const matched = (data || []).filter(m =>
    normPlate(m.vehicle_plate).includes(pk) ||
    (m.external_id || '') === clean || (m.dossier_number || '') === clean ||
    String(m.mission_number || '') === clean,
  )

  // Dédup par plaque : fiche la plus pertinente par véhicule.
  const byPlate = new Map<string, any>()
  for (const m of matched) {
    const key = normPlate(m.vehicle_plate) || m.id
    const cur = byPlate.get(key)
    if (!cur || (RANK[m.status] || 0) > (RANK[cur.status] || 0)) byPlate.set(key, m)
  }
  const results = [...byPlate.values()].slice(0, 6).map(m => ({
    id: m.id, plate: m.vehicle_plate,
    vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null,
    ref: m.mission_number ? `#${m.mission_number}` : null,
    zone: m.parc_zone_key || null,
  }))
  return NextResponse.json({ results })
}
