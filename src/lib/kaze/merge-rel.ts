// src/lib/kaze/merge-rel.ts
//
// Fusion d'une RELIVRAISON Kaze dans la fiche du véhicule DÉJÀ EN PARC.
//
// Extrait tel quel de /api/missions/confirm (Olivier 2026-08-13) pour que le
// même geste puisse se faire TOUT SEUL à l'arrivée du job, sans passer par
// l'écran de commande : « pourquoi passer par une acceptation manuelle ?
// Ça ne serait pas plus simple qu'elle s'auto-valide et évite de polluer
// l'écran de commande ? ».
//
// Règle métier inchangée : véhicule en parc ⇒ la DESTINATION devient l'adresse
// du parc, et l'ancienne destination (le garage/client) devient l'adresse de
// RELIVRAISON. Le job Kaze de la relivraison est TRANSFÉRÉ au parent dans
// `rel_kaze_job_id` — surtout pas dans `kaze_job_id`, qui reste celui du
// remorquage : les deux jobs se clôturent séparément, chacun le sien.

import type { createAdminClient } from '@/lib/supabase'
import { acceptKazeProposalBg } from '@/lib/missions/provider-accept-bg'
import { reprintLabelForMission } from '@/lib/missions/reprint-label-helper'

export interface KazeRelSource {
  id:                   string
  kaze_job_id?:         string | null
  kaze_proposal_id?:    string | null
  destination_address?: string | null
  destination_lat?:     number | null
  destination_lng?:     number | null
}

export async function mergeKazeRelIntoParked(opts: {
  sb:        ReturnType<typeof createAdminClient>
  rel:       KazeRelSource
  parentId:  string
  actorId:   string | null
  /** Qui a validé — « le dispatch » ou l'automatisme. Apparaît dans le journal. */
  actorName: string
}): Promise<{ zone: string; labelPrinted: boolean; redelivery: string | null }> {
  const { sb, rel, parentId, actorId, actorName } = opts
  const now = new Date().toISOString()

  // 1. Validation Kaze conservée (proposal de la relivraison).
  await acceptKazeProposalBg(rel.id, rel.kaze_proposal_id, actorId, sb)

  // Adresse du parc (dépôt où le véhicule est physiquement) → destination.
  let parcAddr: string | null = null
  {
    const { data: pRow } = await sb.from('incoming_missions')
      .select('depot_depart_id').eq('id', parentId).maybeSingle()
    const depotId = (pRow as any)?.depot_depart_id
    if (depotId) {
      const { data: d } = await sb.from('depots').select('address').eq('id', depotId).maybeSingle()
      parcAddr = (d?.address || '').trim() || null
    }
    if (!parcAddr) {
      const { data: d } = await sb.from('depots').select('address').eq('is_default', true).eq('active', true).maybeSingle()
      parcAddr = (d?.address || '').trim() || null
    }
  }

  // 2. Compléter la fiche parc parent + transfert du lien Kaze.
  const redelivery = (rel.destination_address || '').trim() || null
  // K1 « en attente d'adresse » si la relivraison n'a pas de vraie destination
  // (absente ou = un de nos dépôts), sinon K.
  const { relivraisonZoneFor } = await import('@/lib/parc/relivraison-zone')
  const relZone = await relivraisonZoneFor(sb, redelivery)
  const updParent: Record<string, any> = {
    parc_zone_key:   relZone,
    parc_row_number: null,
    parc_slot_index: null,
    mission_type:    'REM+REL',
    rel_kaze_job_id: rel.kaze_job_id || null,
    updated_at:      now,
  }
  if (redelivery)                  updParent.redelivery_address  = redelivery
  if (parcAddr)                    updParent.destination_address = parcAddr
  if (rel.destination_lat != null) updParent.redelivery_lat      = rel.destination_lat
  if (rel.destination_lng != null) updParent.redelivery_lng      = rel.destination_lng
  await sb.from('incoming_missions').update(updParent).eq('id', parentId)
  await sb.from('mission_logs').insert({
    mission_id: parentId, actor_id: actorId, action: 'request_relivraison',
    notes: `Relivraison Kaze rattachée → zone ${relZone}${redelivery ? ' · ' + redelivery : ''} (${actorName})`,
    metadata: { merged_from_kaze_rel: rel.id, redelivery_address: redelivery },
  }).then(() => {}, () => {})

  // 3. Neutraliser la fiche relivraison Kaze (pas de mission séparée).
  //    Le job Kaze est TRANSFÉRÉ : il est déjà copié dans rel_kaze_job_id du
  //    parent → on le RETIRE d'ici, sinon l'INSERT de la relivraison héritière
  //    collisionnerait avec l'index unique partiel sur kaze_job_id.
  //    merged_into_mission_id → la fiche s'affiche « Fusionnée » et non « Refusée ».
  await sb.from('incoming_missions')
    .update({ status: 'ignored', kaze_job_id: null, merged_into_mission_id: parentId, updated_at: now })
    .eq('id', rel.id)
  await sb.from('mission_logs').insert({
    mission_id: rel.id, actor_id: actorId, action: 'kaze_rel_merged',
    notes: 'Relivraison Kaze fusionnée dans la fiche en parc (procédure « À relivrer » généralisée).',
    metadata: { parent_mission_id: parentId },
  }).then(() => {}, () => {})

  // 4. Étiquette REL du parent (best-effort).
  let labelPrinted = false
  try { const r = await reprintLabelForMission({ kind: 'uuid', value: parentId }); labelPrinted = !!r.ok } catch { /* non bloquant */ }

  return { zone: relZone, labelPrinted, redelivery }
}
