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

export const ACCEPT_TOL_PCT = 0.05   // 5 % (Olivier 2026-08-09, était 3 %)
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
    // On inclut AUSSI les fiches 'sia_couvert' (Siabis couvert) FACTURÉES À
    // TOURING (billed_to_name ~ 'touring'). Olivier 2026-07-28.
    const { data: missions } = await sb.from('incoming_missions')
      .select('id, mission_number, dossier_number, external_id, source, status, mission_type, estimated_htva, special_tarif_htva, amount_to_collect, incident_lat, incident_lng, destination_lat, destination_lng, vehicle_class, parent_mission_id, billed_to_name, billed_to_id, snc_scenario, snc_requires_balisage, intervention_date, received_at, extra_addresses')
      .in('dossier_number', expanded)
      .in('source', ['touring', 'sia_couvert'])
      .not('status', 'in', '(cancelled,ignored)')
    for (const m of (missions || [])) {
      // Siabis couvert : uniquement si le client de facturation est Touring.
      if (m.source === 'sia_couvert' && !/touring/i.test(String(m.billed_to_name || ''))) continue
      const k = dossierKey(m.dossier_number)
      const list = byDossier.get(k) || []
      list.push(m)
      byDossier.set(k, list)
    }
  }

  // Garde-fou : dossiers COMEX sans correspondance exacte → rapprochement de
  // secours si la référence dossier est CONTENUE dans dossier_number (n° répété
  // ou mal saisi), CONFIRMÉ par la plaque. Évite un « no_match » à cause d'une
  // simple faute de frappe dans le n° de dossier. Olivier 2026-07-31.
  {
    const SEL_FB = 'id, mission_number, dossier_number, external_id, source, status, mission_type, estimated_htva, special_tarif_htva, amount_to_collect, incident_lat, incident_lng, destination_lat, destination_lng, vehicle_class, parent_mission_id, billed_to_name, billed_to_id, snc_scenario, snc_requires_balisage, intervention_date, received_at, extra_addresses, vehicle_plate'
    const normPlate = (p: string) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    for (const d of dossiers) {
      if (!d.dossier || byDossier.has(d.dossier)) continue
      const { data: cand } = await sb.from('incoming_missions').select(SEL_FB)
        .ilike('dossier_number', `%${d.dossier}%`)
        .in('source', ['touring', 'sia_couvert'])
        .not('status', 'in', '(cancelled,ignored)')
        .limit(10)
      const hit = (cand || []).filter((m: any) => {
        if (m.source === 'sia_couvert' && !/touring/i.test(String(m.billed_to_name || ''))) return false
        // Confirmation par la plaque si connue des deux côtés (anti faux positif).
        if (d.plaque && m.vehicle_plate) return normPlate(d.plaque) === normPlate(m.vehicle_plate)
        return true
      })
      if (hit.length) byDossier.set(d.dossier, hit)
    }
  }

  // Tarif attendu VD Soft : estimated_htva figé si présent, sinon calcul live.
  async function vdTariff(m: any): Promise<number | null> {
    if (m.special_tarif_htva && Number(m.special_tarif_htva) > 0) return Number(m.special_tarif_htva)
    if (m.estimated_htva && Number(m.estimated_htva) > 0) return Number(m.estimated_htva)
    if (m.amount_to_collect && Number(m.amount_to_collect) > 0) return Number(m.amount_to_collect) / 1.21
    // Siabis couvert / SNC : le tarif n'est pas dans estimateMissionPrice (lib) —
    // il faut le calcul dédié (computeSncMetrics + buildSncQuoteLines), comme la
    // fiche. On renvoie le total dépannage HTVA. Olivier 2026-07-28.
    if ((m.source === 'sia_couvert' || m.source === 'police_snc') && m.snc_scenario) {
      try {
        const { computeSncMetrics, buildSncQuoteLines } = await import('@/lib/snc/pricing')
        const variant = m.source === 'sia_couvert' ? 'sc' : 'snc'
        const stops = (Array.isArray(m.extra_addresses) ? m.extra_addresses : [])
          .slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
          .map((s: any) => ({ lat: s.lat, lng: s.lng, label: s.label || s.address }))
        const metrics = await computeSncMetrics({
          scenario: m.snc_scenario, requiresBalisage: Boolean(m.snc_requires_balisage),
          interventionLat: m.incident_lat, interventionLng: m.incident_lng,
          destinationLat: m.destination_lat, destinationLng: m.destination_lng,
          interventionAt: m.intervention_date || m.received_at, variant,
          billedToId: m.billed_to_id, billedToName: m.billed_to_name, stops,
        } as any)
        if (metrics) {
          const missionRef = m.external_id || m.dossier_number || String(m.id).slice(0, 8)
          const lines = buildSncQuoteLines({ metrics, requiresBalisage: Boolean(m.snc_requires_balisage), missionRef, variant } as any)
          const total = (lines || []).reduce((s: number, l: any) => s + l.qty * l.price_unit, 0)
          if (total > 0) return Math.round(total * 100) / 100
        }
      } catch { /* ignore */ }
    }
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
  // GARDE-FOU : on n'évince JAMAIS les dossiers d'un compte dont le login/fetch a
  // ÉCHOUÉ ce run. Un login BKO raté renvoie 0 dossier → « pas vu » ≠ « sorti ».
  // Sans ce garde, un échec de login intermittent (canILog="not logged…") évince
  // des dossiers encore présents (in_comex=false) → l'auto-validation les ignore
  // et le dossier stagne en to_invoice. C'est ce qui bloquait STR1711 / 2026BE315977.
  // Olivier 2026-08-09.
  let left = 0
  const erroredAccounts = new Set((errors || []).map((e: any) => e.account))
  const { data: cached } = await sb.from('touring_comex_dossiers')
    .select('id, account, dossier, cid_seq_action').eq('in_comex', true)
  const seenSet = new Set(seenKeys.map(k => `${k.account}|${k.dossier}|${k.cid}`))
  const goneIds = (cached || [])
    .filter((r: any) => !erroredAccounts.has(r.account)
      && !seenSet.has(`${r.account}|${r.dossier}|${r.cid_seq_action || ''}`))
    .map((r: any) => r.id)
  if (goneIds.length) {
    await sb.from('touring_comex_dossiers').update({ in_comex: false, last_seen_at: now }).in('id', goneIds)
    left = goneIds.length
  }

  return { accounts: new Set(dossiers.map(d => d.account)).size, comex: dossiers.length, matched, okCount: ok, verifyCount: verify, noMatchCount: noMatch, left, errors }
}
