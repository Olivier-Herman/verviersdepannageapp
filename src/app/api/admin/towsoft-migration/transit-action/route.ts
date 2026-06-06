// src/app/api/admin/towsoft-migration/transit-action/route.ts
//
// POST /api/admin/towsoft-migration/transit-action
// Body : { mission_id, action, note? }
//
// Actions possibles sur une mission en Transit / migration_pending=true :
//   - 'sortie_avant_migration' : status='completed', migration_pending=false, note
//   - 'fantome'               : status='cancelled', migration_pending=false, note
//   - 'search_verviers'       : migration_pending_reason='search_verviers', reste en Transit
//   - 'mark_resolved'         : retire migration_pending (cas re-scanne ailleurs ou OK)
//
// Log audit dans mission_logs.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type TransitAction = 'sortie_avant_migration' | 'fantome' | 'search_verviers' | 'mark_resolved'

const ACTION_LABELS: Record<TransitAction, string> = {
  sortie_avant_migration: 'Sortie avant migration (cloturée)',
  fantome:                'Fantôme / inexistant (annulée)',
  search_verviers:        'À chercher au site Verviers',
  mark_resolved:          'Marquée comme résolue',
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const missionId = String(body.mission_id || '').trim()
  const action    = String(body.action || '').trim() as TransitAction
  const note      = String(body.note || '').trim() || null

  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
  if (!ACTION_LABELS[action]) return NextResponse.json({ error: `action invalide : ${action}` }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()

  // Charge la mission pour audit
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, mission_number, vehicle_plate, source, parc_zone_key, status, migration_pending, migration_pending_reason')
    .eq('id', missionId)
    .maybeSingle()
  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (!mission.migration_pending) {
    return NextResponse.json({ error: 'Cette mission n est pas en migration_pending', mission_id: missionId }, { status: 400 })
  }

  // Determine l update selon l action
  const updatePayload: Record<string, any> = {
    updated_at: new Date().toISOString(),
  }

  switch (action) {
    case 'sortie_avant_migration':
      updatePayload.status                   = 'completed'
      updatePayload.completed_at             = new Date().toISOString()
      updatePayload.migration_pending        = false
      updatePayload.migration_pending_reason = null
      updatePayload.parc_zone_key            = null
      updatePayload.parc_row_number          = null
      updatePayload.parc_slot_index          = null
      break
    case 'fantome':
      updatePayload.status                   = 'cancelled'
      updatePayload.migration_pending        = false
      updatePayload.migration_pending_reason = null
      updatePayload.parc_zone_key            = null
      updatePayload.parc_row_number          = null
      updatePayload.parc_slot_index          = null
      break
    case 'search_verviers':
      updatePayload.migration_pending_reason = 'search_verviers'
      // reste en Transit, reste pending
      break
    case 'mark_resolved':
      updatePayload.migration_pending        = false
      updatePayload.migration_pending_reason = null
      break
  }

  const { error: upErr } = await sb
    .from('incoming_missions')
    .update(updatePayload)
    .eq('id', missionId)

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // Log audit
  await sb.from('mission_logs').insert({
    mission_id: missionId,
    action:     `migration_transit_${action}`,
    notes:      note
      ? `${ACTION_LABELS[action]} — ${note}`
      : ACTION_LABELS[action],
    actor_id:   actor?.id || null,
    metadata:   {
      action,
      from_status:  mission.status,
      from_reason:  mission.migration_pending_reason,
      note,
    },
  }).then(() => {}, e => console.warn('[transit-action] log KO:', e?.message))

  return NextResponse.json({
    ok: true,
    action,
    label: ACTION_LABELS[action],
    mission_id: missionId,
    mission_number: mission.mission_number,
  })
}
