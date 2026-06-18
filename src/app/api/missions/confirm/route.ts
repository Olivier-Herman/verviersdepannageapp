// src/app/api/missions/confirm/route.ts
// Confirme (new→dispatching ou assigned) ou refuse (new→ignored) une mission.
// À la confirmation : création AUTO du dossier Odoo (Helpdesk + FSM Task).

import { NextResponse }                 from 'next/server'
import { getServerSession }             from 'next-auth'
import { authOptions }                  from '@/lib/auth'
import { createAdminClient }            from '@/lib/supabase'
import { createOdooDossierForMission } from '@/lib/missions/odoo-dossier'
import { withOdooActor }                from '@/lib/odoo'

export const maxDuration = 60   // propagation Kaze en arrière-plan (~2-5s)

/**
 * Olivier 2026-06-18 : répercute la décision dispatch dans Kaze.
 *  - Valider  → acceptProposal  (on accepte la proposition côté IMA)
 *  - Refuser  → rejectProposal  (on refuse la proposition côté IMA)
 * Best-effort + en arrière-plan : ne bloque JAMAIS la réponse au dispatcher.
 * Ignoré si la mission n'est pas une mission Kaze (kaze_job_id absent).
 */
async function propagateKazeDecision(
  missionId:  string,
  kazeJobId:  string | null | undefined,
  accept:     boolean,
  actorId:    string | null,
  supabase:   ReturnType<typeof createAdminClient>,
) {
  if (!kazeJobId) return
  const run = (async () => {
    try {
      const { acceptProposal, rejectProposal } = await import('@/lib/kaze/client')
      if (accept) await acceptProposal(kazeJobId)
      else        await rejectProposal(kazeJobId)
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId, action: 'kaze_synced',
        notes: accept ? 'Kaze ↗ proposition acceptée' : 'Kaze ↗ proposition refusée',
      }).then(() => {}, () => {})
    } catch (e: any) {
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId, action: 'kaze_sync_error',
        notes: `Kaze ↗ ${accept ? 'acceptation' : 'refus'} proposition : échec — ${e?.message || 'inconnue'}`,
        metadata: { kaze_job_id: kazeJobId, accept },
      }).then(() => {}, () => {})
    }
  })()
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(run) }
  catch { await run }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mission_id, action, reason } = await req.json()

  if (!mission_id || !action) {
    return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: actor } = await supabase
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()

  const now = new Date().toISOString()

  if (action === 'confirm') {
    // Vérifier si un chauffeur est déjà assigné
    const { data: mission } = await supabase
      .from('incoming_missions')
      .select('assigned_to, kaze_job_id')
      .eq('id', mission_id)
      .single()

    const newStatus = mission?.assigned_to ? 'assigned' : 'dispatching'

    await supabase
      .from('incoming_missions')
      .update({ status: newStatus, updated_at: now })
      .eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id: actor?.id || null,
      action:   'dispatched',
      notes:    `Mission confirmée par ${actor?.name || 'dispatcher'}`,
    })

    // Mission Kaze → accepter la proposition côté IMA (best-effort, arrière-plan).
    await propagateKazeDecision(mission_id, mission?.kaze_job_id, true, actor?.id || null, supabase)

    // Création AUTO du dossier Odoo (Helpdesk + FSM Task) — best effort, non bloquant.
    // Si ça plante, le dispatcher peut toujours utiliser le bouton "Créer dossier Odoo"
    // sur la fiche mission (route /api/fsm/create-mission, idempotent).
    // Olivier 2026-06-04 : wrap dans withOdooActor pour utiliser la cle perso.
    let odooResult: any = null
    try {
      odooResult = await withOdooActor(actor?.id, () => createOdooDossierForMission(mission_id))
      if (odooResult.created) {
        await supabase.from('mission_logs').insert({
          mission_id,
          actor_id: actor?.id || null,
          action:   'odoo_synced',
          notes:    `Dossier Odoo créé : helpdesk #${odooResult.ticketId}, task #${odooResult.taskId}`,
        })
      }
    } catch (e: any) {
      console.error('[Confirm] Création Odoo échouée (non bloquant):', e.message)
      await supabase.from('mission_logs').insert({
        mission_id,
        actor_id: actor?.id || null,
        action:   'error',
        notes:    `Création Odoo échouée : ${e.message}. Réessayer via le bouton "Créer dossier Odoo".`,
      })
    }

    return NextResponse.json({
      ok:     true,
      status: newStatus,
      odoo:   odooResult ? {
        ticketId:  odooResult.ticketId,
        ticketUrl: odooResult.ticketUrl,
        taskId:    odooResult.taskId,
        taskUrl:   odooResult.taskUrl,
        created:   odooResult.created,
      } : null,
    })

  } else if (action === 'refuse') {
    const { data: mission } = await supabase
      .from('incoming_missions')
      .select('kaze_job_id')
      .eq('id', mission_id)
      .single()

    await supabase
      .from('incoming_missions')
      .update({ status: 'ignored', updated_at: now })
      .eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id: actor?.id || null,
      action:   'cancelled',
      notes:    reason || 'Mission refusée',
    })

    // Mission Kaze → refuser la proposition côté IMA (best-effort, arrière-plan).
    await propagateKazeDecision(mission_id, mission?.kaze_job_id, false, actor?.id || null, supabase)

    return NextResponse.json({ ok: true, status: 'ignored' })
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
}
