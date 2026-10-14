// src/lib/missions/assistance-closure.ts — la fiche attend-elle encore une clôture chez une
// assistance ? (Olivier 14/10/2026 : une fusion fait disparaître la fiche absorbée, et sa
// clôture chez l'assistance avec elle.) Marqueurs connus : Touring (acceptée dans COMEX, pas de
// log « touring_closed »), VAB (affectation Comet, pas de vab_closed_at), AXA (ordre de mission,
// pas d'axa_closed_at). Kaze et Allianz/Hexalite : pas de marqueur fiable, non contrôlés.
import type { createAdminClient } from '@/lib/supabase'

type Sb = ReturnType<typeof createAdminClient>

export async function pendingAssistanceClosure(sb: Sb, missionId: string): Promise<string | null> {
  const { data: m } = await sb.from('incoming_missions').select('id, status, source_format, touring_accepted_at, vab_assignment_ids, vab_closed_at, axa_mission_order_id, axa_closed_at').eq('id', missionId).maybeSingle()
  if (!m || ['cancelled', 'ignored', 'deleted'].includes(String(m.status))) return null
  if (m.touring_accepted_at || m.source_format === 'comex') {
    const { count } = await sb.from('mission_logs').select('id', { count: 'exact', head: true }).eq('mission_id', m.id).eq('action', 'touring_closed')
    if (!count) return 'Touring (COMEX)'
  }
  if (Array.isArray(m.vab_assignment_ids) && m.vab_assignment_ids.length && !m.vab_closed_at) return 'VAB (Comet)'
  if (m.axa_mission_order_id && !m.axa_closed_at) return 'AXA (go&assist)'
  return null
}
