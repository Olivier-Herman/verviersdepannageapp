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

  // Rapprochement VD Soft : un dossier COMEX peut couvrir PLUSIEURS fiches
  // (chaîne REM parent + REL enfant « <dossier>-REL »). On les regroupe par
  // clé = dossier_number sans le suffixe « -… ».
  const numbers = Array.from(new Set(dossiers.map(d => d.dossier).filter(Boolean)))
  const expanded = Array.from(new Set([...numbers, ...numbers.map(n => `${n}-REL`)]))
  const dossierKey = (dn: string) => String(dn || '').split('-')[0]
  const byDossier = new Map<string, any[]>()   // clé dossier → fiches[]
  if (expanded.length) {
    // On rapproche les fiches touring de TOUT statut (sauf annulées/neutralisées)
    // pour AFFICHER le statut VD Soft dans l'onglet. Seules les `to_invoice`
    // sont facturables (bouton Accepter) ; les autres affichent leur statut.
    const { data: missions } = await sb.from('incoming_missions')
      .select('id, mission_number, dossier_number, source, status, mission_type, estimated_htva, special_tarif_htva, amount_to_collect, incident_lat, incident_lng, destination_lat, destination_lng, vehicle_class, parent_mission_id')
      .in('dossier_number', expanded)
      .eq('source', 'touring')
      .not('status', 'in', '(cancelled,ignored)')
    for (const m of (missions || [])) {
      const k = dossierKey(m.dossier_number)
      const list = byDossier.get(k) || []
      list.push(m)
      byDossier.set(k, list)
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

    // Ordre de « pertinence » de la fiche principale à afficher.
    const SR: Record<string, number> = { to_invoice: 9, completed: 8, invoiced: 7, delivering: 6, parked: 5, in_progress: 4, accepted: 3, assigned: 2, dispatching: 1, new: 0 }
    const rank = (s: string) => SR[s] ?? 0
    const pickPrimary = (list: any[]) => [...list].sort((a, b) =>
      (rank(b.status) - rank(a.status)) ||
      ((a.mission_type === 'relivraison' ? 1 : 0) - (b.mission_type === 'relivraison' ? 1 : 0))
    )[0]

  for (const d of dossiers) {
    const all   = byDossier.get(d.dossier) || []
    const toInv = all.filter(f => f.status === 'to_invoice')
    let vd: number | null = null
    let verdict = 'no_match'
    let missionIds: string[] = []
    let fichesDetail: any[] = []
    let primary: any = null

    if (toInv.length) {
      // Facturable : somme des fiches to_invoice de la chaîne.
      matched++
      let sum = 0
      for (const f of toInv) {
        const t = await vdTariff(f)
        sum += Number(t || 0)
        fichesDetail.push({ number: f.mission_number, type: f.mission_type, montant: t })
      }
      vd = fichesDetail.some(x => x.montant != null) ? Math.round(sum * 100) / 100 : null
      missionIds = toInv.map(f => f.id)
      primary = pickPrimary(toInv)
      verdict = tariffVerdict(d.montant, vd)      // 'ok' | 'verify'
    } else if (all.length) {
      // Rapprochée mais PAS to_invoice → on affiche le statut, pas de bouton.
      primary = pickPrimary(all)
      verdict = 'status'
      fichesDetail = all.map(f => ({ number: f.mission_number, type: f.mission_type, montant: null }))
    }
    if (verdict === 'ok') ok++; else if (verdict === 'verify') verify++; else noMatch++

    const row = {
      account: d.account, dossier: d.dossier, cid_seq_action: d.cidSeqAction || '',
      commande: d.commande, prestation: d.prestation, plaque: d.plaque,
      km: d.km, montant: d.montant, trajet: d.trajet, brand: d.brand, model: d.model,
      insurer: d.insurer, file_date: d.fileDate,
      mission_id: primary?.id || null, mission_number: primary?.mission_number || null,
      mission_status: primary?.status || null, mission_type: primary?.mission_type || null,
      mission_ids: missionIds, fiches: fichesDetail, fiche_count: (toInv.length || all.length),
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
