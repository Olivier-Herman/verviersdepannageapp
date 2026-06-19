// src/app/api/missions/confirm/route.ts
// Confirme (new→dispatching ou assigned) ou refuse (new→ignored) une mission.
// À la confirmation : création AUTO du dossier Odoo (Helpdesk + FSM Task).

import { NextResponse }                 from 'next/server'
import { getServerSession }             from 'next-auth'
import { authOptions }                  from '@/lib/auth'
import { createAdminClient }            from '@/lib/supabase'
import { createOdooDossierForMission } from '@/lib/missions/odoo-dossier'
import { withOdooActor }                from '@/lib/odoo'

export const maxDuration = 60   // création dossier Odoo en synchrone (~2-5s)

// NB Kaze (Olivier 2026-06-19) : l'acceptation d'une PROPOSITION Kaze ne passe
// PAS par la clé API (testé : /job_proposals/{id} → 404, /jobs/{id}/proposals →
// 403 feature_not_enabled). C'est une action de l'APPLI WEB (cookie de session
// + CSRF). Implémentée dans lib/kaze/web-session.ts (loginKazeWeb +
// acceptKazeProposal). On la déclenche sur "Valider" si la mission a un
// kaze_proposal_id. Best-effort en arrière-plan : ne bloque jamais le dispatch.

async function acceptKazeProposalBg(
  missionId:  string,
  proposalId: string | null | undefined,
  actorId:    string | null,
  supabase:   ReturnType<typeof createAdminClient>,
) {
  if (!proposalId) return
  const run = (async () => {
    try {
      const { acceptKazeProposal } = await import('@/lib/kaze/web-session')
      const r = await acceptKazeProposal(proposalId)
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId,
        action: r.ok ? 'kaze_synced' : 'kaze_sync_error',
        notes:  r.ok
          ? 'Kaze ↗ proposition acceptée (session web)'
          : `Kaze ↗ acceptation proposition : échec — ${r.error || 'inconnue'}`,
        metadata: { proposal_id: proposalId, http: r.status, ok: r.ok, error: r.error ?? null },
      }).then(() => {}, () => {})
    } catch (e: any) {
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId, action: 'kaze_sync_error',
        notes: `Kaze ↗ acceptation proposition : exception — ${e?.message || 'inconnue'}`,
        metadata: { proposal_id: proposalId },
      }).then(() => {}, () => {})
    }
  })()
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(run) }
  catch { await run }
}

// Mission Allianz/mondial : accepter l'affectation dans Hexalite (API à token,
// PUT status EDSRA). Best-effort en arrière-plan. Olivier 2026-06-19.
async function acceptAllianzBg(
  missionId:        string,
  assignmentNumber: string | null | undefined,
  actorId:          string | null,
  supabase:         ReturnType<typeof createAdminClient>,
) {
  if (!assignmentNumber) return
  const run = (async () => {
    try {
      const { acceptAllianzByNumber } = await import('@/lib/allianz/intake')
      const r = await acceptAllianzByNumber(assignmentNumber)
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId,
        action: r.ok ? 'allianz_synced' : 'allianz_sync_error',
        notes:  r.ok
          ? 'Allianz ↗ affectation acceptée (Hexalite)'
          : `Allianz ↗ acceptation : échec — ${r.error || 'inconnue'}`,
        metadata: { assignment_number: assignmentNumber, http: r.status ?? null, ok: r.ok, error: r.error ?? null },
      }).then(() => {}, () => {})
    } catch (e: any) {
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId, action: 'allianz_sync_error',
        notes: `Allianz ↗ acceptation : exception — ${e?.message || 'inconnue'}`,
        metadata: { assignment_number: assignmentNumber },
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
      .select('assigned_to, kaze_proposal_id, source, dossier_number, external_id')
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

    // Mission Kaze en proposition → accepter dans Kaze (appli web, arrière-plan).
    await acceptKazeProposalBg(mission_id, mission?.kaze_proposal_id, actor?.id || null, supabase)

    // Mission Allianz/mondial → accepter l'affectation dans Hexalite (API, arrière-plan).
    if (mission?.source === 'mondial') {
      await acceptAllianzBg(mission_id, mission?.dossier_number || mission?.external_id || null, actor?.id || null, supabase)
    }

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

    return NextResponse.json({ ok: true, status: 'ignored' })
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
}
