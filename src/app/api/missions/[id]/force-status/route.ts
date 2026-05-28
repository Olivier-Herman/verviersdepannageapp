// src/app/api/missions/[id]/force-status/route.ts
//
// POST /api/missions/[id]/force-status { status }
//
// Action dispatcher : force le statut d'une mission sans passer par le
// pointage chauffeur. Utile pour debloquer une mission abandonnee, la
// reinitialiser, ou la cloturer sans photos.
//
// Reserve admin/superadmin/dispatcher.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isRelEligibleSource } from '@/lib/missions/rel-eligible'
import { isRemorquage }        from '@/lib/missions/mission-types'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUS = ['new', 'dispatching', 'assigned', 'in_progress', 'parked', 'delivering', 'completed', 'to_invoice'] as const

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin', 'dispatcher'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const userId = (session.user as any).id

  const body = await req.json() as {
    status?:           string
    reset_assignment?: boolean
    // Olivier 2026-05-28 : pour "Forcer en parc", le dispatcher choisit
    // explicitement le depot de depart et la zone du parc.
    depot_depart_id?:  string | null
    parc_zone_key?:    string | null
    parc_row_number?:  number | null
    parc_slot_index?:  number | null
  }
  if (!body.status || !(ALLOWED_STATUS as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: `Status invalide. Allowed: ${ALLOWED_STATUS.join(', ')}` }, { status: 400 })
  }

  const sb = createAdminClient()
  const now = new Date().toISOString()

  const update: any = {
    status:     body.status,
    updated_at: now,
  }

  // Si on réinitialise à "dispatching" ou "new" → désassigner le chauffeur
  if (body.status === 'dispatching' || body.status === 'new' || body.reset_assignment) {
    update.assigned_to = null
    update.assigned_at = null
    update.accepted_at = null
    update.on_way_at   = null
    update.on_site_at  = null
    update.loaded_at   = null
    update.parked_at   = null
    update.completed_at = null
  }

  // Si on force "completed" ou "to_invoice" → set completed_at si pas déjà
  if (body.status === 'completed' || body.status === 'to_invoice') {
    update.completed_at = now
  }

  // Si on force "parked" → set parked_at + (optionnel) depot + zone parc
  if (body.status === 'parked') {
    update.parked_at = now

    // Olivier 2026-05-28 : depot et zone parc obligatoires pour "Forcer en parc".
    if (body.depot_depart_id !== undefined) {
      update.depot_depart_id = body.depot_depart_id || null
    }
    if (body.parc_zone_key !== undefined) {
      update.parc_zone_key = body.parc_zone_key || null
    }
    if (body.parc_row_number !== undefined) {
      update.parc_row_number = body.parc_row_number != null ? Number(body.parc_row_number) : null
    }
    if (body.parc_slot_index !== undefined) {
      update.parc_slot_index = body.parc_slot_index != null ? Number(body.parc_slot_index) : null
    }

    // Auto-conversion REM -> REM+REL si source eligible ET adresse de
    // relivraison deja connue. Sans adresse, attente saisie.
    const { data: m } = await sb
      .from('incoming_missions')
      .select('source, mission_type, snc_scenario, destination_address, redelivery_address')
      .eq('id', params.id)
      .maybeSingle()
    const hasAddr = !!((m as any)?.redelivery_address || (m as any)?.destination_address)
    if (m && hasAddr && isRemorquage(m.mission_type) && isRelEligibleSource(m.source, (m as any).snc_scenario)) {
      update.mission_type = 'REM+REL'
    }
  }

  const { error } = await sb.from('incoming_missions').update(update).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log
  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   userId,
    action:     `force_status_${body.status}`,
    notes:      `Statut force par dispatcher → ${body.status}`,
    metadata:   { forced_by_role: role, ...(update.assigned_to === null ? { assignment_reset: true } : {}) },
  })

  return NextResponse.json({ ok: true, new_status: body.status })
}
