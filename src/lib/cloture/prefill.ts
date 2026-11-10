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
  // Parent mis « au parc » sans remorquage (reprise par l'assistance d'un véhicule déjà chez nous, Siabis non couvert
  // repris en dossier couvert — 1SXJ696, 10/11/2026) : aucun code à reprendre sur la fiche ni sur le parent. On prend
  // ceux du dernier remorquage clôturé du même véhicule (7 jours), au lieu de refuser la clôture de la relivraison.
  let plate = mission?.vehicle_plate
  if (!plate && mission?.id) plate = (await sb.from('incoming_missions').select('vehicle_plate').eq('id', mission.id).maybeSingle()).data?.vehicle_plate
  const norm = String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (norm.length >= 5) {
    const since = new Date(Date.now() - 7 * 864e5).toISOString()
    const { data: memes } = await sb.from('incoming_missions').select('id, vehicle_plate').ilike('vehicle_plate', `%${norm.slice(-5)}%`).gte('created_at', since).limit(20)
    const ids2 = (memes || []).filter((x: any) => String(x.vehicle_plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === norm && !ids.includes(x.id)).map((x: any) => x.id)
    if (ids2.length) {
      const { data } = await sb.from('mission_logs').select('metadata').in('mission_id', ids2).eq('action', 'touring_closed')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(5)
      for (const row of data || []) { const md: any = (row as any).metadata; if (md?.cause && md?.desc && md?.result) return { cause: md.cause, desc: md.desc, result: md.result } }
    }
  }
  return null
}
