// src/lib/domaine/vente-epaves-parc-sync.ts
//
// Domaine — Vente d'épaves : synchronisation avec le PARC (sans relire les mails,
// gérés par le cron). Retente le rapprochement VIN → fiche parc des lignes de
// trace encore NON rapprochées (une saisie a pu entrer au parc après le mail),
// et backfill les champs domaine (vente/firme/Date IN/Date OUT) sur la fiche
// trouvée. Appelée à l'ouverture du module. Olivier 2026-07-30.

import { SAISIE_SOURCES } from './vente-epaves-intake'

export interface ParcSyncSummary { scanned: number; matched: number; ambiguous: number }

export async function syncVenteEpavesParc(sb: any): Promise<ParcSyncSummary> {
  const out: ParcSyncSummary = { scanned: 0, matched: 0, ambiguous: 0 }

  // Lignes de trace pas encore rapprochées (no_match / ambiguous / sans fiche).
  const { data: rows } = await sb.from('domaine_ventes_epaves')
    .select('id, vin, vin_tail, brand, firm, vente_date, date_in, max_enlevement_date, matched_mission_id, outcome')
    .is('matched_mission_id', null)
    .limit(2000)
  if (!rows?.length) return out

  for (const r of rows) {
    out.scanned++
    const tail = (r.vin_tail || String(r.vin || '').slice(-5)).trim()
    if (!tail) continue

    const { data: hits } = await sb.from('incoming_missions')
      .select('id, mission_number, source, vehicle_vin, vehicle_brand, domaine_vente_date, domaine_vente_firm, domaine_remise_date, domaine_enlevement_date')
      .in('source', SAISIE_SOURCES)
      .is('archived_at', null)
      .neq('status', 'cancelled')
      .ilike('vehicle_vin', `%${tail}`)
      .limit(5)

    // Match unique, ou désambiguïsation par MARQUE (comme l'intake mail).
    let m: any = (hits || []).length === 1 ? hits![0] : null
    if (!m && (hits || []).length > 1) {
      const bn = String(r.brand || '').toLowerCase().split(/\s+/)[0]
      const byBrand = bn ? hits!.filter((h: any) => String(h.vehicle_brand || '').toLowerCase().includes(bn)) : []
      if (byBrand.length === 1) m = byBrand[0]
    }
    if (!m) { if ((hits || []).length > 1) out.ambiguous++; continue }

    // Fiche listée dans le tableau Domaine ⇒ c'est une saisie : normalise la source.
    if (m.source !== 'police_saisie') {
      await sb.from('incoming_missions').update({ source: 'police_saisie' }).eq('id', m.id).then(() => {}, () => {})
    }

    // Backfill des champs domaine SANS écraser un existant (sauf vente_date qui est
    // autoritative depuis le mail). Garantit un montant calculable côté registre.
    const upd: any = {}
    if (r.vente_date && m.domaine_vente_date !== r.vente_date) upd.domaine_vente_date = r.vente_date
    if (r.firm && !m.domaine_vente_firm)                       upd.domaine_vente_firm = r.firm
    if (r.date_in && !m.domaine_remise_date)                  upd.domaine_remise_date = r.date_in
    if (r.max_enlevement_date && !m.domaine_enlevement_date)  upd.domaine_enlevement_date = r.max_enlevement_date
    if (Object.keys(upd).length) await sb.from('incoming_missions').update(upd).eq('id', m.id).then(() => {}, () => {})

    await sb.from('domaine_ventes_epaves')
      .update({ matched_mission_id: m.id, outcome: 'applied' })
      .eq('id', r.id).then(() => {}, () => {})

    await sb.from('mission_logs').insert({
      mission_id: m.id, actor_id: null, action: 'domaine_vente_parc_match',
      notes: `Rapproché au parc (synchro Vente d'épaves)${r.firm ? ` · vendu à ${r.firm}` : ''}${r.vente_date ? ` · vente ${r.vente_date}` : ''}`,
      metadata: { source: 'vente_epaves_parc_sync', vin: r.vin, trace_id: r.id },
    }).then(() => {}, () => {})

    out.matched++
  }
  return out
}
