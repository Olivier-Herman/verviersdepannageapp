// src/app/api/missions/confirm/route.ts
// Confirme (new→dispatching ou assigned) ou refuse (new→ignored) une mission.
// À la confirmation : création AUTO du dossier Odoo (Helpdesk + FSM Task).

import { NextResponse }                 from 'next/server'
import { getServerSession }             from 'next-auth'
import { authOptions }                  from '@/lib/auth'
import { createAdminClient }            from '@/lib/supabase'
import { createOdooDossierForMission } from '@/lib/missions/odoo-dossier'
import { withOdooActor }                from '@/lib/odoo'
import { acceptTouringBg }              from '@/lib/touring/accept-bg'
import { acceptVabBg }                  from '@/lib/vab/accept-bg'
import { acceptKazeProposalBg, acceptAllianzBg } from '@/lib/missions/provider-accept-bg'
import { acceptAxaBg }                  from '@/lib/axa/affect-bg'

export const maxDuration = 60   // création dossier Odoo en synchrone (~2-5s)

// Acceptations fournisseur (Kaze proposition / Allianz Hexalite) + Touring COMEX :
// déclenchées à « Valider » ET à l'assignation directe. Logique PARTAGÉE avec
// /api/missions/assign → extraite dans @/lib/missions/provider-accept-bg et
// @/lib/touring/accept-bg. Olivier 2026-07-13.

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
      .select('assigned_to, kaze_proposal_id, kaze_job_id, source, source_format, dossier_number, external_id, axa_mission_order_id, incident_type, parent_mission_id, vehicle_plate, destination_address, destination_lat, destination_lng')
      .eq('id', mission_id)
      .single()

    // ── Relivraison Kaze : fusion dans la fiche parc parent (Olivier 2026-07-04) ──
    // Le dispatch veut UNE seule vue "À relivrer". Au lieu de créer une mission REL
    // séparée en attente, on complète la fiche parent DÉJÀ en parc (adresse de
    // relivraison + zone K + REM+REL) → elle suit la procédure généralisée. On GARDE
    // l'acceptation Kaze (sinon rien n'est validé côté Kaze) et on TRANSFÈRE le lien
    // Kaze sur le parent pour que la relivraison se clôture automatiquement dans Kaze
    // à la fin (la REL généralisée hérite du kaze_job_id — voir create-relivraison.ts).
    // Détection robuste : une mission Kaze RELivraison = incident_type 'relivraison'
    // OU (plus fiable) une mission Kaze qui pointe déjà vers une fiche parente REM
    // (parent_mission_id posé à l'import via la convention IMA AA/AB).
    const isKazeRel = mission?.source === 'kaze'
      && (mission?.incident_type === 'relivraison' || !!mission?.parent_mission_id)
    if (isKazeRel) {
      // Rapprochement : lien parent AA/AB d'abord, sinon même plaque. On accepte
      // un parent EN PARC (→ relivraison) OU EN COURS (→ destination). Olivier 2026-07-14.
      const ACTIVE_PARENT = ['assigned', 'accepted', 'in_progress', 'delivering']
      let parentId: string | null = null
      let parentStatus: string | null = null
      if (mission.parent_mission_id) {
        const { data } = await supabase.from('incoming_missions')
          .select('id, status').eq('id', mission.parent_mission_id).maybeSingle()
        if (data && (data.status === 'parked' || ACTIVE_PARENT.includes(data.status))) { parentId = data.id; parentStatus = data.status }
      }
      if (!parentId && mission.vehicle_plate) {
        const { data } = await supabase.from('incoming_missions')
          .select('id, status').eq('vehicle_plate', mission.vehicle_plate)
          .in('status', ['parked', ...ACTIVE_PARENT]).neq('id', mission_id)
          .order('received_at', { ascending: false }).limit(1).maybeSingle()
        if (data) { parentId = data.id; parentStatus = data.status }
      }

      // ── Parent EN COURS (pas encore en parc) : la REM/relivraison qui arrive
      // pendant que le chauffeur est encore sur la 1ère mission (DSP en cours) va
      // dans la DESTINATION de la fiche EN COURS (le chauffeur enchaîne le
      // remorquage), PAS dans Relivraison. Olivier 2026-07-14.
      if (parentId && parentStatus !== 'parked') {
        await acceptKazeProposalBg(mission_id, mission?.kaze_proposal_id, actor?.id || null, supabase)
        const dest = (mission.destination_address || '').trim() || null
        const updParent: Record<string, any> = {
          mission_type:    'remorquage',                 // le DSP enchaîne sur un remorquage
          rel_kaze_job_id: mission.kaze_job_id || null,  // 2e job Kaze → clôture couplée
          updated_at:      now,
        }
        if (dest)                            updParent.destination_address = dest
        if (mission.destination_lat != null) updParent.destination_lat     = mission.destination_lat
        if (mission.destination_lng != null) updParent.destination_lng     = mission.destination_lng
        await supabase.from('incoming_missions').update(updParent).eq('id', parentId)
        // Neutraliser la fiche Kaze REM (transfert du job → retirer kaze_job_id
        // pour éviter la collision d'index unique).
        await supabase.from('incoming_missions')
          // merged_into_mission_id : la fiche s'affiche « Fusionnée » avec un lien
          // vers celle conservée, au lieu de « Refusée » en rouge. Rien n'a été
          // refusé — ni chez nous, ni chez Kaze. Olivier 2026-08-13.
          .update({ status: 'ignored', kaze_job_id: null, merged_into_mission_id: parentId, updated_at: now }).eq('id', mission_id)
        await supabase.from('mission_logs').insert({
          mission_id: parentId, actor_id: actor?.id || null, action: 'dispatched',
          notes: `REM Kaze rattaché à la mission EN COURS → destination${dest ? ' · ' + dest : ''} (validé par ${actor?.name || 'dispatcher'})`,
          metadata: { merged_from_kaze_rel: mission_id, destination_address: dest, parent_status: parentStatus },
        }).then(() => {}, () => {})
        await supabase.from('mission_logs').insert({
          mission_id, actor_id: actor?.id || null, action: 'kaze_rel_merged',
          notes: `Fusionné dans la fiche EN COURS (adresse REM → destination).`,
          metadata: { parent_mission_id: parentId },
        }).then(() => {}, () => {})
        return NextResponse.json({ ok: true, merged_into: parentId, into: 'destination' })
      }

      if (parentId) {
        // Fusion dans la fiche en parc — logique partagée avec l'auto-fusion à
        // l'arrivée du job (src/lib/kaze/merge-rel.ts). Olivier 2026-08-13.
        const { mergeKazeRelIntoParked } = await import('@/lib/kaze/merge-rel')
        const r = await mergeKazeRelIntoParked({
          sb: supabase, parentId, actorId: actor?.id || null,
          actorName: `validée par ${actor?.name || 'dispatcher'}`,
          rel: {
            id: mission_id,
            kaze_job_id:         mission.kaze_job_id,
            kaze_proposal_id:    (mission as any).kaze_proposal_id,
            destination_address: mission.destination_address,
            destination_lat:     mission.destination_lat,
            destination_lng:     mission.destination_lng,
          },
        })
        return NextResponse.json({ ok: true, merged_into: parentId, zone: r.zone, label_printed: r.labelPrinted })
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

    // Mission Touring COMEX → accepter + délai 60 + assign DE-001 (arrière-plan, gaté).
    await acceptTouringBg(mission_id, mission?.source || null, (mission as any)?.source_format || null, actor?.id || null, supabase)

    // Mission VAB → accepter dans Comet DÈS LA VALIDATION DU DISPATCH, sans
    // attendre le pointage chauffeur (arrière-plan). Cf lib/vab/accept-bg.ts :
    // VAB voyait le dossier « à accepter » 20 min en médiane, jusqu'à 4 h.
    await acceptVabBg(mission_id, mission?.source || null, actor?.id || null, supabase)

    // Mission Allianz/mondial → accepter l'affectation dans Hexalite (API, arrière-plan).
    if (mission?.source === 'mondial') {
      await acceptAllianzBg(mission_id, mission?.dossier_number || mission?.external_id || null, actor?.id || null, supabase)
    }

    // Mission liée à go&assist (AXA) → VALIDER (nouveau → à affecter) si encore
    // New (auto-no-op si déjà validée). On cible via axa_mission_order_id (le
    // lien go&assist) — présent seulement si le dossier est dans go&assist ;
    // sinon rien (clôture VD Soft pure). Arrière-plan.
    if ((mission as any)?.axa_mission_order_id) {
      await acceptAxaBg(mission_id, (mission as any).axa_mission_order_id, actor?.id || null, supabase)
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
