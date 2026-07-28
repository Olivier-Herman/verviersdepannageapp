// src/lib/missions/parc-fleet-state.ts
//
// Parc automobile Odoo : passe le véhicule (fleet.vehicle) en "Terminé" quand
// TOUT le dossier (fiche + parent + enfants) a atteint un statut terminal
// (to_invoice / invoiced / completed). Pour un dossier avec relivraison, c'est
// donc la DERNIÈRE fiche à basculer en to_invoice qui déclenche le passage.
//
// - Ne dépend QUE de odoo_vehicle_id (pas de odoo_task_id) → marche pour toutes
//   les sources (police, assistance…), contrairement à l'ancienne logique.
// - Idempotent : réécrire "Terminé" est sans effet.
// - Best-effort : ne jette jamais (log seulement). Olivier 2026-07-28.

import { updateVehicleState, FLEET_STATES } from '@/lib/odoo-fsm'

const TERMINAL = new Set(['to_invoice', 'invoiced', 'completed'])
const DEAD     = new Set(['cancelled', 'canceled', 'ignored', 'no_charge'])

export async function syncParcVehicleTerminated(sb: any, missionId: string): Promise<void> {
  try {
    const { data: m } = await sb.from('incoming_missions')
      .select('id, parent_mission_id, odoo_vehicle_id, status')
      .eq('id', missionId).maybeSingle()
    if (!m) return

    // Dossier complet = la racine (parent ou soi-même) + ses enfants.
    const root = m.parent_mission_id || m.id
    const { data: chain } = await sb.from('incoming_missions')
      .select('id, status, odoo_vehicle_id')
      .or(`id.eq.${root},parent_mission_id.eq.${root}`)
    const fiches: any[] = (chain && chain.length) ? chain : [m]

    // Véhicule Odoo lié (celui de la fiche courante, sinon n'importe lequel du dossier).
    const vehId = m.odoo_vehicle_id || fiches.find(f => f.odoo_vehicle_id)?.odoo_vehicle_id
    if (!vehId) return

    // Une fiche encore active (ni terminale ni morte) → le dossier n'est pas fini.
    const pending = fiches.some(f => !TERMINAL.has(f.status) && !DEAD.has(f.status))
    if (pending) return

    // Il faut au moins une fiche réellement facturable (pas QUE des annulées).
    if (!fiches.some(f => TERMINAL.has(f.status))) return

    await updateVehicleState(Number(vehId), FLEET_STATES.termine)
  } catch (e: any) {
    console.error('[parc-fleet-state] syncParcVehicleTerminated échec (non bloquant):', e?.message)
  }
}
