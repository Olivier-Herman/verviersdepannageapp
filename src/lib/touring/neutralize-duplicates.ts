// src/lib/touring/neutralize-duplicates.ts
//
// Garde-fou anti-doublon Touring : Touring peut ré-affecter un même dossier sous
// un nouveau n° d'affectation (external_id), ce qui crée une 2ᵉ fiche `new`.
// On neutralise (status='ignored') toute fiche `new` dont le n° de DOSSIER a déjà
// une fiche en statut AVANCÉ (assignée…facturée). RISQUE NUL : un `new` ne peut
// jamais être « plus avancé » qu'une vraie mission → on ne perd aucune mission
// légitime. Olivier 2026-07-27.

const HANDLED = ['assigned', 'accepted', 'in_progress', 'delivering', 'parked', 'to_invoice', 'completed', 'invoiced']

export async function neutralizeTouringDuplicates(sb: any): Promise<{ ignored: number; refs: string[] }> {
  const { data: news } = await sb.from('incoming_missions')
    .select('id, mission_number, dossier_number')
    .eq('source', 'touring').eq('status', 'new')
  const refs: string[] = []
  const now = new Date().toISOString()
  for (const n of (news || [])) {
    if (!n.dossier_number) continue
    // Fiche sœur (même n° de dossier EXACT) en statut avancé ?
    const { count } = await sb.from('incoming_missions')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'touring').eq('dossier_number', n.dossier_number)
      .neq('id', n.id).in('status', HANDLED)
    if (!count) continue
    const { error } = await sb.from('incoming_missions')
      .update({ status: 'ignored', updated_at: now }).eq('id', n.id)
    if (error) continue
    refs.push(`#${n.mission_number}`)
    await sb.from('mission_logs').insert({
      mission_id: n.id, action: 'ignored',
      notes: `Doublon d'affectation Touring (dossier ${n.dossier_number} déjà traité) — neutralisée automatiquement`,
      metadata: { dedup_dossier: true, auto: true },
    }).then(() => {}, () => {})
  }
  return { ignored: refs.length, refs }
}
