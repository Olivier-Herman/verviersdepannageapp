// src/lib/parc/exit-parc.ts
//
// Sortie du parc MAINTENANT d'un véhicule (Olivier 08/09/2026) : la fiche
// principale quitte 'parked' → le trigger ferme la fiche Gardiennage ouverte
// (parc_exit_at = now, plus une nuit de plus), la place est libérée, le
// journal est écrit. Partagé par « Clôturer et facturer » (dossier) et
// « Restituer » (écran QR). Gardes : contrôle de sortie des épaves gérées par
// un bureau d'expertise, scénario SNC obligatoire.

import { assertExitAllowed }   from '@/lib/missions/exit-control'
import { releaseParcAndShift } from '@/lib/parc/release'

export type ExitReason = 'enlevement_transporteur' | 'restitution' | 'sortie'

export async function exitParcNow(sb: any, rootId: string, actor: { id: string | null; name?: string | null }, reason: ExitReason, note?: string): Promise<{ ok: true; released: any } | { ok: false; error: string; status: number; exit_control_blocked?: boolean }> {
  const { data: root } = await sb.from('incoming_missions').select('id, status, source, snc_scenario, mission_number, parc_zone_key, dossier_leg').eq('id', rootId).maybeSingle()
  if (!root) return { ok: false, error: 'Fiche introuvable', status: 404 }
  if (root.dossier_leg) return { ok: false, error: 'Cette fiche est le volet Gardiennage : agis sur la fiche principale.', status: 409 }
  if (root.status !== 'parked') return { ok: false, error: `Le véhicule n'est pas au parc (fiche ${root.status}).`, status: 409 }
  if (['police_snc', 'sia_couvert'].includes(String(root.source || '')) && !root.snc_scenario) {
    return { ok: false, error: 'Scénario SNC requis avant la sortie : choisis-le sur la fiche.', status: 409 }
  }
  const gate = await assertExitAllowed(sb, root.id, { via: 'restitution' })
  if (!gate.ok) return { ok: false, error: gate.error, status: 409, exit_control_blocked: true }

  const now = new Date().toISOString()
  const { error: upErr } = await sb.from('incoming_missions')
    .update({ status: 'to_invoice', completed_at: now, updated_at: now })
    .eq('id', root.id)
  if (upErr) return { ok: false, error: upErr.message, status: 500 }
  // Motif de sortie sur la fiche Gardiennage que le trigger vient de fermer.
  await sb.from('incoming_missions')
    .update({ parc_exit_reason: reason, updated_at: now })
    .eq('parent_mission_id', root.id).eq('dossier_leg', true).eq('parc_exit_reason', 'sortie').gte('parc_exit_at', new Date(Date.now() - 120_000).toISOString())
    .then(() => {}, () => {})
  let released: any = null
  try { released = await releaseParcAndShift(sb, root.id) } catch (e: any) { console.warn('[exit-parc] libération parc KO (non bloquant):', e?.message) }
  const label = reason === 'enlevement_transporteur' ? 'enlèvement par un transporteur' : reason === 'restitution' ? 'restitution au client' : 'sortie'
  await sb.from('mission_logs').insert({
    mission_id: root.id, actor_id: actor.id || null, action: 'force_status_to_invoice',
    notes: `Sortie du parc : ${label}${root.parc_zone_key ? ` (zone ${root.parc_zone_key})` : ''}, gardiennage arrêté maintenant${note ? ` — ${note}` : ''}`,
    metadata: { via: 'exit_parc', reason, released },
  }).then(() => {}, () => {})
  return { ok: true, released }
}
