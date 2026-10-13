// src/lib/cloture/prefill.ts
//
// Codes de panne de la mission — ou de sa MISSION D'ORIGINE quand c'est une relivraison.
//
// « Une relivraison ne doit jamais demander le code panne. Le code panne est déterminé avant la mise en parc. La
// voiture, en restant dans le parc, n'a pas de raison de changer de code panne. C'est un parking, pas Lourdes »
// (Olivier 2026-08-18). On va donc chercher les codes chez le parent.
export async function prefillCodes(sb: any, mission: any): Promise<{ cause: string; desc: string; result: string } | null> {
  const ids = [mission?.id, mission?.parent_mission_id].filter(Boolean)
  for (const id of ids) {
    const { data } = await sb.from('mission_logs')
      .select('metadata').eq('mission_id', id).eq('action', 'touring_closed')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const md: any = (data as any)?.metadata
    if (md?.cause && md?.desc && md?.result) return { cause: md.cause, desc: md.desc, result: md.result }
  }
  return null
}
