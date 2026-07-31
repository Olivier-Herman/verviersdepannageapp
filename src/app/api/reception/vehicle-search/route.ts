// Recherche véhicule pour la borne visiteur : propose les fiches VD Soft par
// plaque / n° de dossier / réf. Restreint à l'IP du bureau (données fiche).
// GET /api/reception/vehicle-search?q=1ABC

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const normPlate = (p: string) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export async function GET(req: NextRequest) {
  const raw = (new URL(req.url).searchParams.get('q') || '').trim()
  const clean = raw.replace(/[^A-Za-z0-9-]/g, '')
  if (clean.length < 2) return NextResponse.json({ results: [] })

  const sb = createAdminClient()
  const RANK: Record<string, number> = { parked: 6, to_invoice: 5, delivering: 4, in_progress: 3, accepted: 2, completed: 1 }
  const parts = [`vehicle_plate.ilike.%${clean}%`, `external_id.ilike.%${clean}%`, `dossier_number.ilike.%${clean}%`]
  if (/^\d+$/.test(clean)) parts.push(`mission_number.eq.${clean}`)

  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, status, parc_zone_key, created_at')
    .or(parts.join(','))
    .not('status', 'in', '(cancelled,ignored,parse_error)')
    .order('created_at', { ascending: false })
    .limit(40)

  // Dédup par plaque : on garde la fiche la plus pertinente (statut) par véhicule.
  const byPlate = new Map<string, any>()
  for (const m of (data || [])) {
    const key = normPlate(m.vehicle_plate) || m.id
    const cur = byPlate.get(key)
    if (!cur || (RANK[m.status] || 0) > (RANK[cur.status] || 0)) byPlate.set(key, m)
  }
  const results = [...byPlate.values()].slice(0, 8).map(m => ({
    id: m.id,
    plate: m.vehicle_plate,
    vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null,
    ref: m.mission_number ? `#${m.mission_number}` : null,
    zone: m.parc_zone_key || null,
  }))
  return NextResponse.json({ results })
}
