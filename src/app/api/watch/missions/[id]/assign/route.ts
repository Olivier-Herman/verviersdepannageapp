// src/app/api/watch/missions/[id]/assign/route.ts
//
// POST /api/watch/missions/[id]/assign
// Auth : Authorization: Bearer <watch-jwt>
// Acces : dispatcher / admin / superadmin
//
// Body : { driver_id: string }
//
// Assigne une mission a un chauffeur depuis la Watch. Reprend la meme logique
// que /api/missions/assign (manuelle web) : update status, cancel auto-dispatch
// en cours, log, notif chauffeur, FSM Odoo, creation dossier Odoo si wasNew.

import { NextResponse }              from 'next/server'
import { createAdminClient }         from '@/lib/supabase'
import { verifyWatchAuth }           from '@/lib/auth-watch'
import { sendNotification }          from '@/lib/notifications/send'
import { rpcFsm, getFsmStageId, FSM_FIELDS } from '@/lib/odoo-fsm'
import { createOdooDossierForMission } from '@/lib/missions/odoo-dossier'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actorId = await verifyWatchAuth(req)
  if (!actorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const missionId = String(params.id || '').trim()
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const driverId = String(body.driver_id || '').trim()
  if (!driverId) return NextResponse.json({ error: 'driver_id requis' }, { status: 400 })

  const sb = createAdminClient()

  // Verifie role de l appelant
  const { data: actor } = await sb
    .from('users')
    .select('id, role, roles')
    .eq('id', actorId)
    .single()
  if (!actor) return NextResponse.json({ error: 'Acteur introuvable' }, { status: 404 })

  const actorRoles = (Array.isArray(actor.roles) ? actor.roles as string[] : [actor.role].filter(Boolean) as string[])
    .map(r => String(r ?? '').trim().toLowerCase())
  const isSuperadmin = actorRoles.includes('superadmin')
  const isDispatcher = isSuperadmin || actorRoles.some(r => r === 'dispatcher' || r === 'admin')
  if (!isDispatcher) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Mission
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('id, external_id, source, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_address, incident_city, odoo_task_id, status, assigned_to')
    .eq('id', missionId)
    .single()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const wasNew = mission.status === 'new'

  // Driver
  const { data: driver } = await sb
    .from('users')
    .select('id, name')
    .eq('id', driverId)
    .single()
  if (!driver) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })

  const now = new Date().toISOString()

  // Update mission
  await sb
    .from('incoming_missions')
    .update({ status: 'assigned', assigned_to: driverId, assigned_at: now })
    .eq('id', missionId)

  // Cancel auto-dispatch en cours (manuel prime)
  await sb
    .from('dispatch_attempts_log')
    .update({ status: 'cancelled', updated_at: now })
    .eq('mission_id', missionId)
    .in('status', ['pending', 'push_sent', 'call_1_sent', 'call_2_sent'])

  // Log
  await sb.from('mission_logs').insert({
    mission_id: missionId,
    actor_id:   actorId,
    action:     'dispatched',
    notes:      `Assigné à ${driver.name} (via Watch)`,
    metadata:   { driver_id: driverId, driver_name: driver.name, via: 'watch' },
  })

  // Creation dossier Odoo si la mission etait 'new' (assignation = confirmation implicite)
  if (wasNew) {
    try {
      const odooResult = await createOdooDossierForMission(missionId)
      if (odooResult.created) {
        await sb.from('mission_logs').insert({
          mission_id: missionId,
          actor_id:   actorId,
          action:     'odoo_synced',
          notes:      `Dossier Odoo cree : helpdesk #${odooResult.ticketId}, task #${odooResult.taskId}`,
        })
      }
    } catch (e: any) {
      console.error('[watch/assign] Odoo dossier echec (non bloquant):', e.message)
      await sb.from('mission_logs').insert({
        mission_id: missionId,
        actor_id:   actorId,
        action:     'error',
        notes:      `Creation Odoo echouee : ${e.message}. Reessayer via "Creer dossier Odoo".`,
      })
    }
  }

  // Notif chauffeur (push iPhone + Watch automatiquement via device_tokens)
  const mtNorm = (mission.mission_type || '').toLowerCase().trim()
  const typeLabel = ['rem', 'remorquage'].includes(mtNorm)                          ? '🚛 Remorquage'
                  : ['dsp', 'depannage', 'reparation_place'].includes(mtNorm)        ? '🔧 Dépannage'
                  : ['rel', 'relivraison'].includes(mtNorm)                          ? '🚛 Relivraison'
                  : '📋 Mission'
  const vehicleLabel = [mission.vehicle_brand, mission.vehicle_model, mission.vehicle_plate]
    .filter(Boolean).join(' ')

  await sendNotification(driverId, 'mission_assigned_manual', {
    title:      `${typeLabel} — ${(mission.source || '').toUpperCase()}`,
    body:       `${vehicleLabel} — ${mission.incident_city || mission.incident_address || ''}`,
    action_url: `/mission/${missionId}`,
    mission_id: missionId,
  })

  // FSM Odoo (best effort)
  if (mission.odoo_task_id) {
    try {
      const stageId = await getFsmStageId('Assigné')
      await rpcFsm('project.task', 'write', [[mission.odoo_task_id], {
        stage_id:                       stageId,
        [FSM_FIELDS.chauffeur_name]:    driver.name || '',
        [FSM_FIELDS.chauffeur_id]:      driverId,
      }])
    } catch (e: any) {
      console.error('[watch/assign] FSM update echec (non bloquant):', e.message)
    }
  }

  return NextResponse.json({
    ok:          true,
    status:      'assigned',
    mission_id:  missionId,
    driver_id:   driverId,
    driver_name: driver.name,
  })
}
