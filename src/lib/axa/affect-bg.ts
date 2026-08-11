// src/lib/axa/affect-bg.ts
//
// Affectation AXA go&assist en arrière-plan, déclenchée au moment de l'ASSIGNATION
// d'un chauffeur dans VD Soft (/api/missions/assign). Équivalent AXA des
// acceptations fournisseur (cf provider-accept-bg.ts). PATCH /mission/dispatch,
// appointmentAt = assignation + 1h (convention Olivier). Best-effort / idempotent.

import type { createAdminClient } from '@/lib/supabase'

export async function affectAxaBg(
  missionId:      string,
  missionOrderId: string | null | undefined, // = incoming_missions.external_id
  actorId:        string | null,
  supabase:       ReturnType<typeof createAdminClient>,
) {
  if (!missionOrderId) return
  const run = (async () => {
    try {
      const { dispatchMission } = await import('@/lib/axa/goassist')
      const r = await dispatchMission(missionOrderId)
      await supabase.from('mission_logs').insert({
        mission_id: missionId, actor_id: actorId,
        action: r.ok ? 'axa_synced' : 'axa_sync_error',
        notes:  r.ok
          ? 'AXA ↗ mission affectée à notre technicien (go&assist)'
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
  })()
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(run) }
  catch { await run }
}
