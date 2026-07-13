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
import { acceptTouringBg }              from '@/lib/touring/accept-bg'
import { acceptKazeProposalBg, acceptAllianzBg } from '@/lib/missions/provider-accept-bg'

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
      .select('assigned_to, kaze_proposal_id, kaze_job_id, source, source_format, dossier_number, external_id, incident_type, parent_mission_id, vehicle_plate, destination_address, destination_lat, destination_lng')
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

        // Adresse du parc (dépôt où le véhicule est physiquement) → destination.
        // Règle métier : véhicule en parc ⇒ destination = adresse du parc, et
        // l'adresse de RELIVRAISON = l'ancienne destination (le garage/client).
        let parcAddr: string | null = null
        {
          const { data: pRow } = await supabase.from('incoming_missions')
            .select('depot_depart_id').eq('id', parentId).maybeSingle()
          const depotId = (pRow as any)?.depot_depart_id
          if (depotId) {
            const { data: d } = await supabase.from('depots').select('address').eq('id', depotId).maybeSingle()
            parcAddr = (d?.address || '').trim() || null
          }
          if (!parcAddr) {
            const { data: d } = await supabase.from('depots').select('address').eq('is_default', true).eq('active', true).maybeSingle()
            parcAddr = (d?.address || '').trim() || null
          }
        }

        // 2. Compléter la fiche parc parent + transfert du lien Kaze.
        const redelivery = (mission.destination_address || '').trim() || null
        // K1 « en attente d'adresse » si la relivraison n'a pas de vraie destination
        // (absente ou = un de nos dépôts), sinon K. Olivier 2026-07-13.
        const { relivraisonZoneFor } = await import('@/lib/parc/relivraison-zone')
        const relZone = await relivraisonZoneFor(supabase, redelivery)
        const updParent: Record<string, any> = {
          parc_zone_key:    relZone,
          parc_row_number:  null,
          parc_slot_index:  null,
          mission_type:     'REM+REL',
          // Job Kaze de la RELIVRAISON stocké à part : NE PAS écraser kaze_job_id du
          // parent (= job du REMORQUAGE, qui a sa propre clôture). La relivraison
          // généralisée héritera de rel_kaze_job_id (voir create-relivraison.ts) →
          // les DEUX jobs Kaze se clôturent, chacun le sien.
          rel_kaze_job_id:  mission.kaze_job_id || null,
          updated_at:       now,
        }
        if (redelivery)                      updParent.redelivery_address  = redelivery
        if (parcAddr)                        updParent.destination_address = parcAddr   // destination = le parc
        if (mission.destination_lat != null) updParent.redelivery_lat     = mission.destination_lat
        if (mission.destination_lng != null) updParent.redelivery_lng     = mission.destination_lng
        await supabase.from('incoming_missions').update(updParent).eq('id', parentId)
        await supabase.from('mission_logs').insert({
          mission_id: parentId, actor_id: actor?.id || null, action: 'request_relivraison',
          notes: `Relivraison Kaze rattachée → zone ${relZone}${redelivery ? ' · ' + redelivery : ''} (validée par ${actor?.name || 'dispatcher'})`,
          metadata: { merged_from_kaze_rel: mission_id, redelivery_address: redelivery },
        }).then(() => {}, () => {})

        // 3. Neutraliser la fiche relivraison Kaze (pas de mission séparée).
        //    On TRANSFÈRE le job Kaze : il est déjà copié dans rel_kaze_job_id du
        //    parent (ci-dessus) → on le RETIRE de la fiche ignorée, sinon quand la
        //    REL héritera de rel_kaze_job_id, l'INSERT collisionnera avec cette fiche
        //    qui garde le même kaze_job_id (index unique partiel
        //    uq_incoming_missions_kaze_job_id, insensible au statut). Correctif 2026-07-06.
        await supabase.from('incoming_missions')
          .update({ status: 'ignored', kaze_job_id: null, updated_at: now }).eq('id', mission_id)
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

    // Mission Touring COMEX → accepter + délai 60 + assign DE-001 (arrière-plan, gaté).
    await acceptTouringBg(mission_id, mission?.source || null, (mission as any)?.source_format || null, actor?.id || null, supabase)

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
