// src/lib/touring/check-persist.ts
//
// Persiste la liste « Check Touring » construite : upsert des items (en
// préservant le statut/réponse existants), puis purge des 'pending' disparus.

/** Pousse un « ping » realtime pour que les modules ouverts se rechargent. */
export async function bumpCheckSignal(sb: any, reason: string): Promise<void> {
  await sb.from('touring_check_signal')
    .upsert({ id: 1, bumped_at: new Date().toISOString(), reason }, { onConflict: 'id' })
    .then(() => {}, () => {})
}

export async function persistCheckList(sb: any, items: any[]): Promise<void> {
  const now = new Date().toISOString()
  const roots = items.map(i => i.root_mission_id)
  for (const it of items) {
    await sb.from('touring_check_dossiers').upsert({
      root_mission_id:   it.root_mission_id,
      dossier_number:    it.dossier_number,
      intervention_date: it.intervention_date,
      fiches:            it.fiches,
      is_combined:       it.is_combined,
      refreshed_at:      now,
    }, { onConflict: 'root_mission_id' })
  }
  let q = sb.from('touring_check_dossiers').delete().eq('status', 'pending')
  if (roots.length) q = q.not('root_mission_id', 'in', `(${roots.join(',')})`)
  await q
  await bumpCheckSignal(sb, 'list_refreshed')
}
