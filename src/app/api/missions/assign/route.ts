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
import { createOdooDossierForMission } from '@/lib/missions/odoo-dossier'
import { withOdooActor }               from '@/lib/odoo'
import { acceptTouringBg }             from '@/lib/touring/accept-bg'
import { acceptKazeProposalBg, acceptAllianzBg } from '@/lib/missions/provider-accept-bg'
import { affectAxaBg }                  from '@/lib/axa/affect-bg'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mission_id, driver_id } = await req.json()
  if (!mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const supabase = createAdminClient()

  // Récupérer les infos de la mission (incl. odoo_task_id pour update FSM)
  const { data: mission, error: mErr } = await supabase
    .from('incoming_missions')
    .select('id, external_id, source, source_format, kaze_proposal_id, dossier_number, mission_type, vehicle_brand, vehicle_model, vehicle_plate, incident_address, incident_city, odoo_task_id, status')
    .eq('id', mission_id)
    .single()

  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  const wasNew = mission.status === 'new'

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
      .select('id, name, current_truck_id')
      .eq('id', driver_id)
      .single()

    // Olivier 2026-06-01 : si on assigne/reassigne a un chauffeur, on
    // synchronise le truck_id de la mission avec le current_truck du
    // chauffeur. Cas : la mission etait sur Franck (Vanette 3) puis on la
    // reassigne a Momo (Plateau Iveco) -> le truck_id de la mission doit
    // pointer vers le truck de Momo (sinon le matching amendes serait faux).
    // Si le nouveau chauffeur n'a pas de current_truck, on remet a null
    // (sera resaisi a sa prochaine action via le hook driver-action).
    await supabase
      .from('incoming_missions')
      .update({
        status:      'assigned',
        assigned_to: driver_id,
        assigned_at: now,
        truck_id:    (driver as any)?.current_truck_id || null,
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

    // AXA go&assist : au moment de l'assignation VD Soft, on AFFECTE la mission
    // à notre technicien dans go&assist (appointmentAt = assignation + 1h).
    // Best-effort / idempotent. Cf [[project_axa_goassist_integration]].
    if (mission.source === 'axa') {
      await affectAxaBg(mission_id, (mission as any).external_id || null, actor?.id || null, supabase)
    }

    // Live Activity « push-to-start » : fait apparaître la mission sur le device
    // du chauffeur (Dynamic Island + écran verrouillé) dès l'attribution, pour
    // qu'il l'ACCEPTE sans ouvrir l'app. Best-effort. Olivier 2026-07-26.
    try {
      const { pushStartLiveActivity } = await import('@/lib/native/pushLiveActivity')
      await pushStartLiveActivity(mission_id)
    } catch (e: any) { console.error('[assign] push-to-start LA KO:', e?.message) }

    // Olivier 2026-06-02 : si mission demandee par un garage, notifier le garage
    // que la mission est acceptee (best-effort, log silencieux).
    try {
      const { notifyGarageOfMissionEvent } = await import('@/lib/notifications/garage')
      await notifyGarageOfMissionEvent(mission_id, 'accepted')
    } catch (e) { /* silent */ }

    // Assignation directe depuis "En commande" (status='new') = confirmation
    // implicite : on cree le dossier Odoo comme le ferait /api/missions/confirm.
    // Best effort, non bloquant — si echec, "Creer dossier Odoo" reste dispo
    // sur la fiche.
    if (wasNew) {
      try {
        // Olivier 2026-06-05 : wrap dans withOdooActor pour utiliser la cle
        // API perso du dispatcher (Jona/Olivier) au lieu du fallback VD App.
        const odooResult = await withOdooActor(actor?.id, () => createOdooDossierForMission(mission_id))
        if (odooResult.created) {
          await supabase.from('mission_logs').insert({
            mission_id,
            actor_id: actor?.id || null,
            action:   'odoo_synced',
            notes:    `Dossier Odoo cree : helpdesk #${odooResult.ticketId}, task #${odooResult.taskId}`,
          })
        }
      } catch (e: any) {
        console.error('[Assign+Confirm] Creation Odoo echouee (non bloquant):', e.message)
        await supabase.from('mission_logs').insert({
          mission_id,
          actor_id: actor?.id || null,
          action:   'error',
          notes:    `Creation Odoo echouee : ${e.message}. Reessayer via "Creer dossier Odoo".`,
        })
      }

      // Assignation DIRECTE d'une mission `new` (sans passer par « Valider ») =
      // confirmation implicite → on déclenche les MÊMES acceptations fournisseur
      // que le bouton Valider. Sans ça, une mission assignée direct n'était jamais
      // acceptée côté fournisseur (il fallait le faire à la main). Olivier 2026-07-13.
      await acceptKazeProposalBg(mission_id, (mission as any).kaze_proposal_id, actor?.id || null, supabase)
      await acceptTouringBg(mission_id, mission.source || null, (mission as any).source_format || null, actor?.id || null, supabase)
      if (mission.source === 'mondial') {
        await acceptAllianzBg(mission_id, (mission as any).dossier_number || mission.external_id || null, actor?.id || null, supabase)
      }
    }

    // Notifier le chauffeur (insensible casse + alias REM/DSP)
    const mtNorm = (mission.mission_type || '').toLowerCase().trim()
    const typeLabel    = ['rem', 'remorquage'].includes(mtNorm)                          ? '🚛 Remorquage'
                       : ['dsp', 'depannage', 'reparation_place'].includes(mtNorm)        ? '🔧 Dépannage'
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
    // Olivier 2026-06-01 : on remet aussi truck_id a null pour eviter une
    // attribution erronee si la mission est ensuite reassignee a un autre
    // chauffeur avec un autre camion.
    await supabase
      .from('incoming_missions')
      .update({ status: 'dispatching', assigned_to: null, assigned_at: null, truck_id: null })
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
