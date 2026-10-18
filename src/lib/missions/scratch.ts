// src/lib/missions/scratch.ts — mise en épave / scratch d'une fiche (sortie du parc, sans frais), partagée par le
// bouton de la fiche (/api/missions/[id]/scratch) et le relevé de parc sans étiquette (Olivier 18/10/2026).
import { withOdooActor, odooRpc } from '@/lib/odoo'
import { FLEET_STATES }      from '@/lib/odoo-fsm'
import { assertExitAllowed } from '@/lib/missions/exit-control'

export async function scratchMission(sb: any, missionId: string, actorId: string | null, reason: string | null): Promise<
  { ok: true; mission: any; odooUpdated: boolean; odooError: string | null } | { ok: false; status: number; error: string; exit_control_blocked?: boolean }> {
  const params = { id: missionId }
  const actor = actorId ? { id: actorId } : null
  // 1. Charge mission
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, mission_number, vehicle_plate, status, parc_zone_key, odoo_vehicle_id, odoo_helpdesk_id')
    .eq('id', params.id)
    .maybeSingle()
  if (mErr || !mission) {
    return { ok: false, status: 404, error: `Mission introuvable : ${mErr?.message || 'unknown'}` }
  }

  // Contrôle de sortie (épave gérée par un bureau d'expertise). Olivier 2026-09-05.
  if (mission.status === 'parked') {
    const gate = await assertExitAllowed(sb, mission.id)
    if (!gate.ok) return { ok: false, status: 409, error: gate.error || 'Sortie bloquée', exit_control_blocked: true }
  }

  // 2. Update VD Soft : sortie du parc + status completed
  const nowIso = new Date().toISOString()
  const { error: upErr } = await sb
    .from('incoming_missions')
    .update({
      status:          'completed',
      completed_at:    nowIso,
      scratched_at:    nowIso,
      scratched_by:    actor?.id || null,
      parc_zone_key:   null,
      parc_row_number: null,
      parc_slot_index: null,
      closing_notes:   reason
        ? `Mis en épave : ${reason}`
        : 'Mis en épave',
      // Une épave ne se facture pas au client : même marque « sans frais » que
      // le module de destruction, sinon la fiche revient dans Facturation par
      // dossier avec tout son gardiennage (4 véhicules le 14/09/2026, jusqu'à
      // 2 225 € HTVA — le correctif du 12/09 ne couvrait que l'autre porte).
      // Le circuit Parquet (saisies) ne lit pas cette marque : il continue.
      no_charge_at:     nowIso,
      no_charge_reason: reason ? `Mis en épave : ${reason}` : 'Mis en épave (scratch)',
      parc_exit_at:     nowIso,
      parc_exit_reason: 'epave',
      updated_at:      nowIso,
    })
    .eq('id', params.id)
  if (upErr) return { ok: false, status: 500, error: `Update KO : ${upErr.message}` }

  // Les volets gardiennage du dossier suivent : sortis, sans frais.
  await sb.from('incoming_missions')
    .update({ parc_exit_at: nowIso, parc_exit_reason: 'epave', no_charge_at: nowIso,
              no_charge_reason: 'Mis en épave (scratch)', updated_at: nowIso })
    .or(`parc_origin_mission_id.eq.${params.id},parent_mission_id.eq.${params.id}`)
    .eq('dossier_leg', true).is('no_charge_at', null)
    .then(() => {}, (e: any) => console.warn(`[scratch] volets gardiennage KO mission=${params.id}:`, e?.message))

  // 3. Log mission_logs
  await sb.from('mission_logs').insert({
    mission_id: params.id,
    action:     'scratched',
    notes:      reason ? `Scratch / épave : ${reason}` : 'Scratch / mis en épave',
    actor_id:   actor?.id || null,
    metadata:   {
      from_zone:   mission.parc_zone_key,
      from_status: mission.status,
      reason,
    },
  }).then(() => {}, (e: any) => console.warn(`[scratch] log KO mission=${params.id}:`, e?.message))

  // 4. Best-effort Odoo : si vehicle_id present, état « Terminé » (les zones Odoo ne sont plus tenues — 09/09/2026)
  let odooUpdated = false
  let odooError: string | null = null
  if (mission.odoo_vehicle_id) {
    try {
      await withOdooActor(actor?.id, async () => {
        await odooRpc('fleet.vehicle', 'write', [[mission.odoo_vehicle_id], { state_id: FLEET_STATES.termine }])
      })
      odooUpdated = true
    } catch (e: any) {
      odooError = String(e?.message || e).slice(0, 200)
      console.warn(`[scratch] Odoo update KO mission=${params.id}:`, e?.message)
    }
  }

  return { ok: true, mission, odooUpdated, odooError }
}
