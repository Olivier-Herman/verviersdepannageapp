// src/lib/axa/affect-bg.ts
//
// Affectation AXA go&assist en arrière-plan, déclenchée au moment de l'ASSIGNATION
// d'un chauffeur dans VD Soft (/api/missions/assign). Équivalent AXA des
// acceptations fournisseur (cf provider-accept-bg.ts). PATCH /mission/dispatch,
// appointmentAt = assignation + 1h (convention Olivier). Best-effort / idempotent.

import type { createAdminClient } from '@/lib/supabase'

async function bg(run: () => Promise<void>) {
  const p = run()
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(p) }
  catch { await p }
}

/**
 * VALIDER une mission AXA côté go&assist (nouveau → à affecter), déclenché au
 * « Valider » VD Soft. On n'accepte QUE si la mission est encore en `New` : si AXA
 * l'a déjà validée lui-même (après rappel tél) elle est déjà `AwaitingDispatch` →
 * rien à faire (auto-prise-en-compte). Best-effort / idempotent.
 */
export async function acceptAxaBg(
  missionId:      string,
  missionOrderId: string | null | undefined, // = incoming_missions.external_id
  actorId:        string | null,
  supabase:       ReturnType<typeof createAdminClient>,
) {
  if (!missionOrderId) return
  await bg(async () => {
    try {
      const { getMissionStatus, acceptMission } = await import('@/lib/axa/goassist')
      const status = await getMissionStatus(missionOrderId)
      if (status !== 'New') {
        await supabase.from('mission_logs').insert({
          mission_id: missionId, actor_id: actorId, action: 'axa_synced',
          notes: `AXA ↗ déjà validée côté go&assist (statut ${status || '?'}) — rien à faire`,
          metadata: { mission_order_id: missionOrderId, status },
        }).then(() => {}, () => {})
        return
      }
      const r = await acceptMission(missionOrderId)
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId,
        action: r.ok ? 'axa_synced' : 'axa_sync_error',
        notes:  r.ok ? 'AXA ↗ mission validée (go&assist : nouveau → à affecter)'
                     : `AXA ↗ validation : échec — ${r.data?.message || r.status}`,
        metadata: { mission_order_id: missionOrderId, http: r.status, ok: r.ok, message: r.data?.message ?? null },
      }).then(() => {}, () => {})
    } catch (e: any) {
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId, action: 'axa_sync_error',
        notes: `AXA ↗ validation : exception — ${e?.message || 'inconnue'}`,
        metadata: { mission_order_id: missionOrderId },
      }).then(() => {}, () => {})
    }
  })
}

/**
 * AFFECTER une mission AXA à notre technicien (go&assist), déclenché à l'ASSIGNATION
 * d'un chauffeur VD Soft. Valide d'abord si encore `New` (assignation directe =
 * validation implicite), puis dispatch. appointmentAt = assignation + 1h. Best-effort.
 */
export async function affectAxaBg(
  missionId:      string,
  missionOrderId: string | null | undefined, // = incoming_missions.external_id
  actorId:        string | null,
  supabase:       ReturnType<typeof createAdminClient>,
) {
  if (!missionOrderId) return
  await bg(async () => {
    try {
      const { getMissionStatus, acceptMission, dispatchMission } = await import('@/lib/axa/goassist')
      // Assignation directe d'une mission encore `New` = validation implicite.
      if ((await getMissionStatus(missionOrderId)) === 'New') {
        await acceptMission(missionOrderId)
      }
      const r = await dispatchMission(missionOrderId)
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId,
        action: r.ok ? 'axa_synced' : 'axa_sync_error',
        notes:  r.ok ? 'AXA ↗ mission affectée à notre technicien (go&assist)'
                     : `AXA ↗ affectation : échec — ${r.data?.message || r.status}`,
        metadata: { mission_order_id: missionOrderId, http: r.status, ok: r.ok, message: r.data?.message ?? null },
      }).then(() => {}, () => {})
    } catch (e: any) {
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId, action: 'axa_sync_error',
        notes: `AXA ↗ affectation : exception — ${e?.message || 'inconnue'}`,
        metadata: { mission_order_id: missionOrderId },
      }).then(() => {}, () => {})
    }
  })
}
