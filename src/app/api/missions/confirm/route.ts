// src/app/api/missions/confirm/route.ts
// Confirme (new→dispatching ou assigned) ou refuse (new→ignored) une mission.
// À la confirmation : création AUTO du dossier Odoo (Helpdesk + FSM Task).

import { NextResponse }                 from 'next/server'
import { getServerSession }             from 'next-auth'
import { authOptions }                  from '@/lib/auth'
import { createAdminClient }            from '@/lib/supabase'
import { createOdooDossierForMission } from '@/lib/missions/odoo-dossier'
import { withOdooActor }                from '@/lib/odoo'
import { reprintLabelForMission }       from '@/lib/missions/reprint-label-helper'

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
      // Garde-fou : on récupère le lien dispatch-drawer du mail d'origine
      // (assignmentId + caseId) pour pouvoir accepter même si la recherche par
      // numéro échoue, et pour proposer un lien direct vers la fiche Hexalite.
      const { data: otp } = await supabase
        .from('allianz_otp_pending')
        .select('dispatch_link, assignment_id')
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const r = await acceptAllianzByNumber(assignmentNumber, {
        dispatchLink: otp?.dispatch_link || null,
        assignmentId: otp?.assignment_id || null,
      })
      const link = r.dispatchLink || otp?.dispatch_link || null
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId,
        action: r.ok ? 'allianz_synced' : 'allianz_sync_error',
        notes:  r.ok
          ? `Allianz ↗ affectation acceptée (Hexalite${r.usedFallback ? ' — via lien mail' : ''})`
          : `Allianz ↗ acceptation : échec — ${r.error || 'inconnue'}${link ? ` · Ouvrir la fiche Hexalite : ${link}` : ''}`,
        metadata: { assignment_number: assignmentNumber, http: r.status ?? null, ok: r.ok, error: r.error ?? null, used_fallback: r.usedFallback ?? false, dispatch_link: link },
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
      .select('assigned_to, kaze_proposal_id, kaze_job_id, source, dossier_number, external_id, incident_type, parent_mission_id, vehicle_plate, destination_address, destination_lat, destination_lng')
      .eq('id', mission_id)
      .single()

    // ── Relivraison Kaze : fusion dans la fiche parc parent (Olivier 2026-07-04) ──
    // Le dispatch veut UNE seule vue "À relivrer". Au lieu de créer une mission REL
    // séparée en attente, on complète la fiche parent DÉJÀ en parc (adresse de
    // relivraison + zone K + REM+REL) → elle suit la procédure généralisée. On GARDE
    // l'acceptation Kaze (sinon rien n'est validé côté Kaze) et on TRANSFÈRE le lien
    // Kaze sur le parent pour que la relivraison se clôture automatiquement dans Kaze
    // à la fin (la REL généralisée hérite du kaze_job_id — voir create-relivraison.ts).
    const isKazeRel = mission?.source === 'kaze' && mission?.incident_type === 'relivraison'
    if (isKazeRel) {
      // Rapprochement : lien parent AA/AB d'abord, sinon même plaque en parc.
      let parentId: string | null = null
      if (mission.parent_mission_id) {
        const { data } = await supabase.from('incoming_missions')
          .select('id, status').eq('id', mission.parent_mission_id).maybeSingle()
        if (data?.status === 'parked') parentId = data.id
      }
      if (!parentId && mission.vehicle_plate) {
        const { data } = await supabase.from('incoming_missions')
          .select('id').eq('vehicle_plate', mission.vehicle_plate)
          .eq('status', 'parked').neq('id', mission_id)
          .order('parked_at', { ascending: false }).limit(1).maybeSingle()
        if (data) parentId = data.id
      }

      if (parentId) {
        // 1. Validation Kaze conservée (proposal de la relivraison).
        await acceptKazeProposalBg(mission_id, mission?.kaze_proposal_id, actor?.id || null, supabase)

        // 2. Compléter la fiche parc parent + transfert du lien Kaze.
        const redelivery = (mission.destination_address || '').trim() || null
        const updParent: Record<string, any> = {
          parc_zone_key:    'K',
          parc_row_number:  null,
          parc_slot_index:  null,
          mission_type:     'REM+REL',
          kaze_job_id:      mission.kaze_job_id || null,
          kaze_proposal_id: mission.kaze_proposal_id || null,
          updated_at:       now,
        }
        if (redelivery)                      updParent.redelivery_address = redelivery
        if (mission.destination_lat != null) updParent.redelivery_lat     = mission.destination_lat
        if (mission.destination_lng != null) updParent.redelivery_lng     = mission.destination_lng
        await supabase.from('incoming_missions').update(updParent).eq('id', parentId)
        await supabase.from('mission_logs').insert({
          mission_id: parentId, actor_id: actor?.id || null, action: 'request_relivraison',
          notes: `Relivraison Kaze rattachée → zone K${redelivery ? ' · ' + redelivery : ''} (validée par ${actor?.name || 'dispatcher'})`,
          metadata: { merged_from_kaze_rel: mission_id, redelivery_address: redelivery },
        }).then(() => {}, () => {})

        // 3. Neutraliser la fiche relivraison Kaze (pas de mission séparée).
        await supabase.from('incoming_missions')
          .update({ status: 'ignored', updated_at: now }).eq('id', mission_id)
        await supabase.from('mission_logs').insert({
          mission_id, actor_id: actor?.id || null, action: 'kaze_rel_merged',
          notes: `Relivraison Kaze fusionnée dans la fiche en parc (procédure « À relivrer » généralisée).`,
          metadata: { parent_mission_id: parentId },
        }).then(() => {}, () => {})

        // 4. Étiquette REL du parent (best-effort).
        let labelPrinted = false
        try { const r = await reprintLabelForMission({ kind: 'uuid', value: parentId }); labelPrinted = !!r.ok } catch { /* non bloquant */ }

        return NextResponse.json({ ok: true, merged_into: parentId, zone: 'K', label_printed: labelPrinted })
      }
      // Aucun parent en parc trouvé → comportement normal (REL = sa propre mission).
    }

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
