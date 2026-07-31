// Reconnaissance du visiteur par téléphone / e-mail : propose les fiches VD Soft
// liées à ce numéro (répertoire de contacts + client_phone/client_email des fiches).
// Protégé par géofence. GET ?phone=..&email=..&lat=..&lng=..

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase'
import { phoneKey, emailKey }        from '@/lib/reception/identity'
import { withinGeofence }            from '@/lib/reception/geofence'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sb = createAdminClient()
  if (!await withinGeofence(sb, searchParams.get('lat'), searchParams.get('lng'))) {
    return NextResponse.json({ results: [], reason: 'geo' }, { status: 403 })
  }

  const pk = phoneKey(searchParams.get('phone'))
  const ek = emailKey(searchParams.get('email'))
  if (!pk && !ek) return NextResponse.json({ results: [] })

  const missionIds = new Set<string>()

  // 1) Répertoire de contacts (numéro/e-mail déjà liés à des fiches).
  if (pk || ek) {
    const or = [pk ? `phone_key.eq.${pk}` : '', ek ? `email.eq.${ek}` : ''].filter(Boolean).join(',')
    const { data } = await sb.from('fiche_contacts').select('mission_id').or(or).not('mission_id', 'is', null).limit(30)
    for (const c of (data || [])) if (c.mission_id) missionIds.add(c.mission_id)
  }

  // 2) Fiches existantes : client_phone (par fragment) / client_email.
  if (pk) {
    const frag = pk.slice(-7)   // 7 derniers chiffres → tolère les formats
    const { data } = await sb.from('incoming_missions')
      .select('id, client_phone').ilike('client_phone', `%${frag}%`)
      .not('status', 'in', '(cancelled,ignored,parse_error)').limit(40)
    for (const m of (data || [])) if (phoneKey(m.client_phone) === pk) missionIds.add(m.id)
  }
  if (ek) {
    const { data } = await sb.from('incoming_missions')
      .select('id').ilike('client_email', ek)
      .not('status', 'in', '(cancelled,ignored,parse_error)').limit(20)
    for (const m of (data || [])) missionIds.add(m.id)
  }

  if (!missionIds.size) return NextResponse.json({ results: [] })

  const { data: ms } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, status, parc_zone_key, created_at')
    .in('id', [...missionIds]).order('created_at', { ascending: false }).limit(8)

  const RANK: Record<string, number> = { parked: 6, to_invoice: 5, delivering: 4, in_progress: 3, accepted: 2, completed: 1 }
  const results = (ms || [])
    .sort((a, b) => (RANK[b.status] || 0) - (RANK[a.status] || 0))
    .slice(0, 5)
    .map(m => ({
      id: m.id, plate: m.vehicle_plate,
      vehicle: [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null,
      ref: m.mission_number ? `#${m.mission_number}` : null,
      zone: m.parc_zone_key || null,
    }))
  return NextResponse.json({ results })
}
