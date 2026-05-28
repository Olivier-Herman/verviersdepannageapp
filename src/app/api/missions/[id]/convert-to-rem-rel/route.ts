// POST /api/missions/[id]/convert-to-rem-rel
// Body : { reason?, notes?, redelivery_address?, redelivery_lat?, redelivery_lng? }
//
// Convertit une mission REM en REM+REL via le bouton "Gerer la mise en parc"
// du dispatcher. Olivier 2026-05-28 : la conversion exige une adresse de
// relivraison. Si la mission n a pas encore d adresse, le payload doit en
// fournir une. Cette adresse devient destination_address + redelivery_address
// pour cohérence avec les autres parts du systeme.
//
// Acces : dispatcher / admin / superadmin.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isRelEligibleSource } from '@/lib/missions/rel-eligible'
import { isRemorquage, isRemRel } from '@/lib/missions/mission-types'

export const dynamic = 'force-dynamic'

interface ConvertBody {
  reason?:             string
  notes?:              string
  redelivery_address?: string
  redelivery_lat?:     number | null
  redelivery_lng?:     number | null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin', 'dispatcher'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const actorId = (session.user as any).id

  const body = await req.json().catch(() => ({})) as ConvertBody
  const reason = body.reason || 'manuel'
  const newAddr = (body.redelivery_address || '').trim() || null

  const sb = createAdminClient()
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, status, source, mission_type, snc_scenario, vehicle_plate, destination_address, redelivery_address')
    .eq('id', params.id)
    .maybeSingle()

  if (mErr || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  if (mission.status !== 'parked') {
    return NextResponse.json({ error: `Mission en statut ${mission.status} — doit etre 'parked' pour conversion REM+REL` }, { status: 422 })
  }

  if (isRemRel(mission.mission_type)) {
    return NextResponse.json({ ok: true, already: true, message: 'Deja en REM+REL' })
  }

  if (!isRemorquage(mission.mission_type)) {
    return NextResponse.json({ error: `Type ${mission.mission_type} non convertible (attendu REM)` }, { status: 422 })
  }

  if (!isRelEligibleSource(mission.source, (mission as any).snc_scenario)) {
    return NextResponse.json({ error: `Source ${mission.source} non eligible a la relivraison` }, { status: 422 })
  }

  // Adresse de relivraison : prend le payload sinon ce qui existe deja.
  const finalAddr = newAddr || (mission as any).redelivery_address || mission.destination_address
  if (!finalAddr) {
    return NextResponse.json({
      error: 'Adresse de relivraison requise. La mission n a pas encore d adresse de destination.',
      missing_address: true,
    }, { status: 422 })
  }

  const now = new Date().toISOString()
  const update: any = {
    mission_type: 'REM+REL',
    updated_at:   now,
  }
  if (newAddr) {
    update.redelivery_address = newAddr
    // Si la mission n a pas encore de destination, on l initialise aussi
    if (!mission.destination_address) update.destination_address = newAddr
    if (body.redelivery_lat != null) update.destination_lat = Number(body.redelivery_lat)
    if (body.redelivery_lng != null) update.destination_lng = Number(body.redelivery_lng)
  }

  const { error: upErr } = await sb
    .from('incoming_missions')
    .update(update)
    .eq('id', params.id)

  if (upErr) {
    console.error('[convert-to-rem-rel]', upErr.message)
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   actorId,
    action:     'convert_to_rem_rel',
    notes:      `Conversion REM -> REM+REL (motif: ${reason}${newAddr ? ', adresse saisie' : ''})${body.notes ? ' — ' + body.notes : ''}`,
    metadata:   { reason, previous_type: mission.mission_type, by_role: role, address_set: !!newAddr },
  })

  return NextResponse.json({ ok: true, new_type: 'REM+REL' })
}
