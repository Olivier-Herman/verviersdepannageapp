// src/lib/domaine/rattacher-remise.ts
//
// Rattachement À LA MAIN d'une remise Domaine (ligne « Dates IN » que le robot
// n'a pas reconnue) à une fiche (Q7, Olivier 11/11/2026). Même effet que le
// robot (lib/domaine/intake.ts) : date de remise posée sur la fiche — ce qui
// ARRÊTE le gardiennage Parquet —, source requalifiée en saisie, journal,
// étiquette DOMAINE. La seule différence : l'auteur est la personne.

export async function rattacherRemise(sb: any, ligneId: string, missionId: string, actorId: string | null): Promise<{ ok: true; deja: boolean } | { ok: false; status: number; error: string }> {
  const { data: row } = await sb.from('domaine_dates_in').select('id, remise_date, vin, pv_remise_name, matched_mission_id, outcome').eq('id', ligneId).maybeSingle()
  if (!row) return { ok: false, status: 404, error: 'Ligne de remise introuvable' }
  if (row.matched_mission_id) return { ok: false, status: 409, error: 'Cette remise est déjà rattachée à une fiche' }
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, source, vehicle_vin, vehicle_plate, vehicle_brand, vehicle_model, parc_zone_key, domaine_remise_date, status')
    .eq('id', missionId).maybeSingle()
  if (!m) return { ok: false, status: 404, error: 'Fiche introuvable' }

  if (m.source !== 'police_saisie') {
    await sb.from('incoming_missions').update({ source: 'police_saisie' }).eq('id', m.id)
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: actorId, action: 'source_requalified',
      notes: `Source « ${m.source} » → « police_saisie » (remise Domaine rattachée à la main)`, metadata: { source: 'domaine_dates_in_manuel', from: m.source, to: 'police_saisie' } }).then(() => {}, () => {})
  }
  const deja = !!m.domaine_remise_date
  if (!deja) {
    await sb.from('incoming_missions').update({
      domaine_remise_date: row.remise_date, domaine_at: new Date().toISOString(),
      domaine_note: `Remise au Domaine (mail Dates IN, rattachée à la main)${row.pv_remise_name ? ` — PV de remise ${row.pv_remise_name}` : ''}`,
    }).eq('id', m.id)
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: actorId, action: 'domaine_remise',
      notes: `Date de remise Domaine ${row.remise_date} posée à la main (remise non reconnue par le robot)${row.pv_remise_name ? ` · PV ${row.pv_remise_name}` : ''}`,
      metadata: { source: 'domaine_dates_in_manuel', remise_date: row.remise_date, vin: row.vin } }).then(() => {}, () => {})
    try {
      const { buildDomaineLabelZPL } = await import('@/lib/print/zpl-templates/domaine-label')
      const { printZPLRaw } = await import('@/lib/print/zebra-raw')
      await printZPLRaw(buildDomaineLabelZPL({ missionId: m.id, missionNumber: m.mission_number, remiseDate: row.remise_date,
        brand: m.vehicle_brand, model: m.vehicle_model, plate: m.vehicle_plate, vin: m.vehicle_vin || row.vin, zone: m.parc_zone_key, pvName: row.pv_remise_name }), { missionId: m.id })
    } catch (e: any) { console.warn('[domaine rattacher] étiquette KO (non bloquant):', e?.message) }
  }
  await sb.from('domaine_dates_in').update({ matched_mission_id: m.id, outcome: deja ? 'already_set' : 'applied', applied_date: deja ? null : row.remise_date }).eq('id', row.id)
  return { ok: true, deja }
}
