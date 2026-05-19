// src/app/api/inventaire/sessions/[id]/complete/route.ts
//
// POST /api/inventaire/sessions/[id]/complete
//
// Cloture la session ET retourne la liste des "manquants" :
// vehicules toujours places (incoming_missions.parc_zone_key IS NOT NULL)
// dans les zones balayees pendant la session, mais qui n ont pas ete scannes.
//
// Logique :
//   - On collecte les zones touchees pendant la session via les items
//     (parc_zone_key non null) + la zone courante de la session.
//   - On recupere les ids scannes (incoming_mission_id != null).
//   - missing = incoming_missions WHERE parc_zone_key IN (touched_zones)
//               AND status IN ('parked', 'delivering')
//               AND id NOT IN (scanned_ids)
//
// L action sur chaque manquant (sortir du parc, deplacer, etc.) se fait
// ensuite cote UI via les endpoints existants (/api/parc/place).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PARKED_STATUSES = ['parked', 'delivering']

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  const { data: sess } = await sb
    .from('inventaire_sessions')
    .select('id, user_id, parc_zone_key')
    .eq('id', params.id)
    .maybeSingle()
  if (!sess) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  if (sess.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 1. Zones touchees pendant la session
  const { data: items } = await sb
    .from('inventaire_session_items')
    .select('parc_zone_key, incoming_mission_id')
    .eq('session_id', params.id)

  const touchedZones = new Set<string>()
  if (sess.parc_zone_key) touchedZones.add(sess.parc_zone_key)
  const scannedIds: string[] = []
  for (const it of (items || [])) {
    if (it.parc_zone_key) touchedZones.add(it.parc_zone_key)
    if (it.incoming_mission_id) scannedIds.push(it.incoming_mission_id)
  }

  let missing: any[] = []
  if (touchedZones.size > 0) {
    let q = sb
      .from('incoming_missions')
      .select('id, external_id, vehicle_plate, vehicle_brand, vehicle_model, client_name, status, parc_zone_key, parc_row_number, parc_slot_index')
      .in('parc_zone_key', Array.from(touchedZones))
      .in('status', PARKED_STATUSES)
    if (scannedIds.length > 0) {
      q = q.not('id', 'in', `(${scannedIds.map(id => `"${id}"`).join(',')})`)
    }
    const { data, error } = await q.order('parc_zone_key').order('parc_row_number').order('parc_slot_index')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    missing = data || []
  }

  // 2. Marque la session comme completee
  const { error: updErr } = await sb
    .from('inventaire_sessions')
    .update({ completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', params.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({
    ok:            true,
    missing,
    touched_zones: Array.from(touchedZones),
  })
}
