// src/lib/missions/claim.ts
//
// Un chauffeur s'attribue une mission libre (status 'new' ou 'dispatching', non
// assignée). Atomique : deux chauffeurs qui prennent la même mission au même
// instant → un seul gagne. Partagé par « Je la prends » (Momo Market, bouton
// Siabis) et « J'accepte » d'une proposition de nuit (market-proposals.ts).
// Olivier 2026-06-02 ; extrait de /api/missions/[id]/claim le 30/09/2026.

import { createAdminClient } from '@/lib/supabase'

// « Nouvelle » ET « En attente » (Olivier 01/10/2026) : un chauffeur peut prendre dans
// Momo Market une mission pas encore validée — la prise VAUT validation (acceptation chez
// l'assistance comprise, comme « Valider » au dispatch) et attribution. Seul le cycle de
// nuit (notification au 1er départ) attend la validation du dispatch (cf. confirm).
export const CLAIMABLE_STATUSES = ['new', 'dispatching']

export type ClaimVia = 'market' | 'siabis' | 'proposal'

export interface ClaimResult {
  ok:      boolean
  status:  number            // code HTTP à renvoyer
  error?:  string
  missionId?: string
}

/**
 * @param freshMinutes fenêtre de fraîcheur (null = pas de limite, cas d'une
 *                     proposition encore ouverte : c'est elle qui fait foi)
 */
export async function claimMission(missionId: string, userId: string, opts: { via: ClaimVia; freshMinutes: number | null }): Promise<ClaimResult> {
  const sb = createAdminClient()

  const { data: m } = await sb.from('incoming_missions')
    .select('id, status, assigned_to, received_at, source, source_format, kaze_proposal_id, dossier_number, external_id, axa_mission_order_id, touring_missing_since')
    .eq('id', missionId)
    .maybeSingle()
  if (!m) return { ok: false, status: 404, error: 'Mission introuvable' }

  if (m.assigned_to)                          return { ok: false, status: 409, error: 'Mission deja prise par un autre chauffeur' }
  if (!CLAIMABLE_STATUSES.includes(m.status)) return { ok: false, status: 409, error: 'Mission deja traitee' }
  if ((m as any).touring_missing_since) return { ok: false, status: 410, error: 'Mission retirée par l’assistance' }

  if (opts.freshMinutes != null) {
    const ageMs = Date.now() - new Date(m.received_at).getTime()
    if (ageMs > opts.freshMinutes * 60 * 1000) {
      return { ok: false, status: 410, error: `Mission expiree (> ${opts.freshMinutes} min)` }
    }
  }

  // Update atomique : ne s applique QUE si toujours pas assignee.
  // PostgREST renvoie data=null si le WHERE ne matche pas → on detecte la
  // race condition (un autre l a deja prise entre notre SELECT et UPDATE).
  const now = new Date().toISOString()
  const { data: claimed, error } = await sb.from('incoming_missions')
    .update({
      status:      'assigned',
      assigned_to: userId,
      assigned_at: now,
      updated_at:  now,
    })
    .eq('id', missionId)
    .is('assigned_to', null)
    .in('status', CLAIMABLE_STATUSES)
    .select('id, mission_number')
    .maybeSingle()

  if (error)    return { ok: false, status: 500, error: error.message }
  if (!claimed) return { ok: false, status: 409, error: 'Mission prise par un autre chauffeur a l instant' }

  // Prise d'une mission pas encore validée : c'est la validation. On accepte chez
  // l'assistance exactement comme « Valider » au dispatch (même fonctions, arrière-plan).
  if (m.status === 'new') {
    await sb.from('mission_logs').insert({ mission_id: missionId, actor_id: userId, action: 'dispatched',
      notes: 'Mission validée par la prise du chauffeur (Momo Market) — acceptée chez l’assistance' })
    try {
      const { acceptTouringBg } = await import('@/lib/touring/accept-bg')
      const { acceptVabBg } = await import('@/lib/vab/accept-bg')
      const { acceptKazeProposalBg, acceptAllianzBg } = await import('@/lib/missions/provider-accept-bg')
      const { acceptAxaBg } = await import('@/lib/axa/affect-bg')
      const mm: any = m
      await acceptKazeProposalBg(missionId, mm.kaze_proposal_id, userId, sb)
      await acceptTouringBg(missionId, mm.source || null, mm.source_format || null, userId, sb)
      await acceptVabBg(missionId, mm.source || null, userId, sb)
      const { data: otpAllianz } = await sb.from('allianz_otp_pending').select('id').eq('mission_id', missionId).limit(1)
      if (mm.source === 'mondial' || (otpAllianz || []).length > 0) await acceptAllianzBg(missionId, mm.dossier_number || mm.external_id || null, userId, sb)
      if (mm.axa_mission_order_id) await acceptAxaBg(missionId, mm.axa_mission_order_id, userId, sb)
    } catch (e: any) { console.error('[claim] acceptation assistance (non bloquant):', e?.message) }
  }

  await sb.from('mission_logs').insert({
    mission_id: missionId,
    actor_id:   userId,
    action:     'claimed_self_service',
    notes:      opts.via === 'siabis'   ? 'Fiche prise depuis le bouton Siabis (création chauffeur, plaque reconnue)'
              : opts.via === 'proposal' ? 'Mission acceptée depuis une proposition de nuit (Momo Market)'
              : 'Mission auto-attribuee via self-service',
  })

  // Olivier 30/09/2026 : propositions de nuit closes (le preneur → acceptée, les
  // autres → annulée + appel raccroché) et « X a pris la mission » aux autres
  // chauffeurs prévenus et au dispatcher de garde. Pas pour le bouton Siabis
  // (fiche créée par le chauffeur lui-même).
  if (opts.via !== 'siabis') {
    const { onMissionTaken } = await import('@/lib/missions/market-proposals')
    await onMissionTaken(missionId, userId, 'claimed')
  }

  // Olivier 2026-06-18 : prendre une mission via Momo Market doit aussi créer le
  // dossier Odoo (helpdesk + tâche FSM + VÉHICULE), comme une assignation
  // classique. Sans ça, une mission prise en self-service arrivait sans dossier
  // ni véhicule Odoo. Best-effort, non bloquant.
  try {
    const { createOdooDossierForMission } = await import('@/lib/missions/odoo-dossier')
    const { withOdooActor } = await import('@/lib/odoo')
    const odoo = await withOdooActor(userId, () => createOdooDossierForMission(missionId))
    if (odoo?.created) {
      await sb.from('mission_logs').insert({
        mission_id: missionId,
        actor_id:   userId,
        action:     'odoo_synced',
        notes:      `Dossier Odoo créé : helpdesk #${odoo.ticketId}, task #${odoo.taskId}`,
      })
    }
  } catch (e: any) {
    console.error('[claim] Création dossier Odoo échouée (non bloquant):', e?.message)
  }

  return { ok: true, status: 200, missionId: claimed.id }
}
