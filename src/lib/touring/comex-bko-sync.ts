// src/lib/touring/comex-bko-sync.ts
//
// Synchronise les dossiers Touring COMEX BKO avec VD Soft (table cache
// touring_comex_dossiers). Utilisé par le cron (toutes les 3 min) et à la
// demande. Rapproche par dossier_number, calcule le tarif attendu VD Soft et
// un verdict (ok / verify / no_match). Olivier 2026-07-27.
//
// Verdict tarifaire (règle Olivier) :
//   - Touring ≥ VD Soft (ou dans la tolérance)      → 'ok'     (on peut valider)
//   - Touring < VD Soft au-delà de la tolérance      → 'verify' (risque sous-paiement)
//   - pas de fiche VD Soft rapprochée                → 'no_match'

import { listAllComexBko, type BkoDossier } from '@/lib/touring/comex-bko'
import { estimateMissionPrice }             from '@/lib/missions/estimate-price'

export const ACCEPT_TOL_PCT = 0.03   // 3 %
export const ACCEPT_TOL_MIN = 2      // ou 2 € mini

export function tariffVerdict(comex: number, vd: number | null): 'ok' | 'verify' {
  if (vd == null || !(vd > 0)) return 'verify'          // pas de référence → on vérifie
  const tol = Math.max(ACCEPT_TOL_MIN, vd * ACCEPT_TOL_PCT)
  return comex >= vd - tol ? 'ok' : 'verify'
}

interface SyncResult { accounts: number; comex: number; matched: number; okCount: number; verifyCount: number; noMatchCount: number; left: number; errors: any[] }

export async function syncComexBko(sb: any): Promise<SyncResult> {
  const { dossiers, errors } = await listAllComexBko()

  // Rapprochement VD Soft : fiches touring dont le dossier_number matche.
  const numbers = Array.from(new Set(dossiers.map(d => d.dossier).filter(Boolean)))
  const byDossier = new Map<string, any>()
  if (numbers.length) {
    const { data: missions } = await sb.from('incoming_missions')
      .select('id, mission_number, dossier_number, source, status, mission_type, estimated_htva, special_tarif_htva, amount_to_collect, incident_lat, incident_lng, destination_lat, destination_lng, vehicle_class, parent_mission_id')
      .in('dossier_number', numbers)
      .eq('source', 'touring')
      .neq('status', 'cancelled')
    // Une fiche par dossier : priorité to_invoice, sinon la plus « avancée ».
    const rank = (s: string) => (s === 'to_invoice' ? 3 : s === 'completed' ? 2 : 1)
    for (const m of (missions || [])) {
      const prev = byDossier.get(m.dossier_number)
      if (!prev || rank(m.status) > rank(prev.status)) byDossier.set(m.dossier_number, m)
    }
  }

  // Tarif attendu VD Soft : estimated_htva figé si présent, sinon calcul live.
  async function vdTariff(m: any): Promise<number | null> {
    if (m.special_tarif_htva && Number(m.special_tarif_htva) > 0) return Number(m.special_tarif_htva)
    if (m.estimated_htva && Number(m.estimated_htva) > 0) return Number(m.estimated_htva)
    if (m.amount_to_collect && Number(m.amount_to_collect) > 0) return Number(m.amount_to_collect) / 1.21
    try { const est = await estimateMissionPrice(m as any); if (est?.ok && Number(est.total_eur) > 0) return Number(est.total_eur) } catch { /* ignore */ }
    return null
  }

  const now = new Date().toISOString()
  let matched = 0, ok = 0, verify = 0, noMatch = 0
  const seenKeys: { account: string; dossier: string; cid: string }[] = []

  for (const d of dossiers) {
    const m = byDossier.get(d.dossier) || null
    let vd: number | null = null
    let verdict = 'no_match'
    if (m) {
      matched++
      vd = await vdTariff(m)
      verdict = tariffVerdict(d.montant, vd)
    }
    if (verdict === 'ok') ok++; else if (verdict === 'verify') verify++; else noMatch++

    const row = {
      account: d.account, dossier: d.dossier, cid_seq_action: d.cidSeqAction || '',
      commande: d.commande, prestation: d.prestation, plaque: d.plaque,
      km: d.km, montant: d.montant, trajet: d.trajet, brand: d.brand, model: d.model,
      insurer: d.insurer, file_date: d.fileDate,
      mission_id: m?.id || null, mission_number: m?.mission_number || null,
      mission_status: m?.status || null, mission_type: m?.mission_type || null,
      vd_montant: vd, verdict,
      in_comex: true, last_seen_at: now,
    }
    await sb.from('touring_comex_dossiers')
      .upsert(row, { onConflict: 'account,dossier,cid_seq_action' })
      .then(() => {}, () => {})
    seenKeys.push({ account: d.account, dossier: d.dossier, cid: d.cidSeqAction || '' })
  }

  // Dossiers qui ont QUITTÉ COMEX (validés/générés ailleurs) → in_comex=false.
  let left = 0
  const { data: cached } = await sb.from('touring_comex_dossiers')
    .select('id, account, dossier, cid_seq_action').eq('in_comex', true)
  const seenSet = new Set(seenKeys.map(k => `${k.account}|${k.dossier}|${k.cid}`))
  const goneIds = (cached || [])
    .filter((r: any) => !seenSet.has(`${r.account}|${r.dossier}|${r.cid_seq_action || ''}`))
    .map((r: any) => r.id)
  if (goneIds.length) {
    await sb.from('touring_comex_dossiers').update({ in_comex: false, last_seen_at: now }).in('id', goneIds)
    left = goneIds.length
  }

  return { accounts: new Set(dossiers.map(d => d.account)).size, comex: dossiers.length, matched, okCount: ok, verifyCount: verify, noMatchCount: noMatch, left, errors }
}
