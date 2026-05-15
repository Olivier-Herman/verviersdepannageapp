// src/app/api/missions/assign/route.ts
//
// Assigne ou désassigne un chauffeur sur une mission.
// À l'assignation : update auto la task FSM Odoo (stage → Assigné + champs chauffeur).

import { NextResponse }              from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { sendNotification }          from '@/lib/notifications/send'
import { rpcFsm, getFsmStageId, FSM_FIELDS } from '@/lib/odoo-fsm'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mission_id, driver_id } = await req.json()
  if (!mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const supabase = createAdminClient()

  // Récupérer les infos de la mission (incl. odoo_task_id pour update FSM)
  const { data: mission, error: mErr } = await supabase
    .from('incoming_missions')
    .select('id, external_id, source, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_address, incident_city, odoo_task_id')
    .eq('id', mission_id)
    .single()

  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Résoudre l'acteur
  const { data: actor } = await supabase
    .from('users')
    .select('id')
    .eq('email', session.user.email!)
    .single()

  const now = new Date().toISOString()

  if (driver_id) {
    // Assigner à un chauffeur
    const { data: driver } = await supabase
      .from('users')
      .select('id, name')
      .eq('id', driver_id)
      .single()

    await supabase
      .from('incoming_missions')
      .update({
        status:      'assigned',
        assigned_to: driver_id,
        assigned_at: now,
      })
      .eq('id', mission_id)

    // Annuler toute tentative auto-dispatch en cours : assignation manuelle prime.
    // Sans ça la card continue à afficher "En cours d'assignation à X" et le cron
    // continue à escalader push → call_1 → call_2 sur l'ancien candidat.
    await supabase
      .from('dispatch_attempts_log')
      .update({ status: 'cancelled', updated_at: now })
      .eq('mission_id', mission_id)
      .in('status', ['pending', 'push_sent', 'call_1_sent', 'call_2_sent'])

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id:  actor?.id || null,
      action:    'dispatched',
      notes:     `Assigné à ${driver?.name}`,
      metadata:  { driver_id, driver_name: driver?.name }
    })

    // Notifier le chauffeur
    const typeLabel    = mission.mission_type === 'remorquage' ? '🚛 Remorquage'
                       : mission.mission_type === 'depannage'  ? '🔧 Dépannage'
                       : '📋 Mission'
    const vehicleLabel = [mission.vehicle_brand, mission.vehicle_model, mission.vehicle_plate]
      .filter(Boolean).join(' ')

    await sendNotification(driver_id, 'mission_assigned_manual', {
      title:      `${typeLabel} — ${mission.source.toUpperCase()}`,
      body:       `${vehicleLabel} — ${mission.incident_city || mission.incident_address || ''}`,
      action_url: `/mission/${mission_id}`,
      mission_id,
    })

    // Update task FSM Odoo : stage → Assigné + chauffeur (best effort, non bloquant)
    if (mission.odoo_task_id) {
      try {
        const stageId = await getFsmStageId('Assigné')
        await rpcFsm('project.task', 'write', [[mission.odoo_task_id], {
          stage_id:                       stageId,
          [FSM_FIELDS.chauffeur_name]:    driver?.name || '',
          [FSM_FIELDS.chauffeur_id]:      driver_id,
        }])
        console.log(`[FSM] Task #${mission.odoo_task_id} → Assigné (chauffeur: ${driver?.name})`)
      } catch (e: any) {
        console.error('[FSM] Update assignation échoué (non bloquant):', e.message)
      }
    }

    return NextResponse.json({ ok: true, status: 'assigned', driver_name: driver?.name })

  } else {
    // Retirer l'assignation (retour à new)
    await supabase
      .from('incoming_missions')
      .update({ status: 'dispatching', assigned_to: null, assigned_at: null })
      .eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id: actor?.id || null,
      action:   'reassigned',
      notes:    'Assignation retirée',
    })

    // Repasser la task FSM en Nouveau (best effort)
    if (mission.odoo_task_id) {
      try {
        const stageId = await getFsmStageId('Nouveau')
        await rpcFsm('project.task', 'write', [[mission.odoo_task_id], {
          stage_id:                       stageId,
          [FSM_FIELDS.chauffeur_name]:    '',
          [FSM_FIELDS.chauffeur_id]:      '',
        }])
        console.log(`[FSM] Task #${mission.odoo_task_id} → Nouveau (désassignation)`)
      } catch (e: any) {
        console.error('[FSM] Update désassignation échoué (non bloquant):', e.message)
      }
    }

    return NextResponse.json({ ok: true, status: 'new' })
  }
}
