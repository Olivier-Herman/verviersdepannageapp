// src/lib/touring/accord-reconcile.ts
//
// Rapprochement automatique : les missions Touring HORS COMEX en attente de
// facturation qui sont déjà présentes dans un accord Touring sont passées en
// « Facturation OK » avec la mention du n° d'accord. Réduit la liste envoyée à
// Touring (cron hebdo + juste avant le mail mensuel).

import { buildDossierAccordMap } from './accord-lookup'
import { markInvoicedOK } from './check-billing'

/** Ensemble des mission_ids couverts par COMEX BKO (in_comex=true). */
async function comexBkoMissionIds(sb: any): Promise<Set<string>> {
  const ids = new Set<string>()
  const { data } = await sb.from('touring_comex_dossiers')
    .select('mission_id, mission_ids').eq('in_comex', true)
  for (const d of data || []) {
    if (d.mission_id) ids.add(d.mission_id)
    for (const mid of (Array.isArray(d.mission_ids) ? d.mission_ids : [])) ids.add(mid)
  }
  return ids
}

export interface ReconcileResult {
  scanned: number
  reconciled: number
  details: Array<{ dossier: string; numAccord: string; mission: string; ok: boolean; skipped?: string }>
}

/**
 * @param actorId  auteur (superadmin) ou null (cron système).
 */
export async function reconcileHorsComexWithAccords(sb: any, actorId: string | null = null): Promise<ReconcileResult> {
  // Missions Touring en attente de facturation.
  const { data: queue } = await sb.from('incoming_missions')
    .select('id, dossier_number')
    .eq('source', 'touring')
    .eq('status', 'to_invoice')
  const bkoIds = await comexBkoMissionIds(sb)

  // Candidats hors-comex avec un n° de dossier exploitable.
  const candidates = (queue || []).filter((m: any) => m.dossier_number && !bkoIds.has(m.id))
  const targets = new Set<string>(candidates.map((m: any) => String(m.dossier_number)))

  const details: ReconcileResult['details'] = []
  if (!targets.size) return { scanned: 0, reconciled: 0, details }

  // Fenêtre : accords des 15 derniers mois (les hors-comex en attente sont récents).
  const sinceMs = Date.now() - 15 * 30 * 24 * 60 * 60 * 1000
  const map = await buildDossierAccordMap(targets, { sinceMs, maxAccords: 100 })

  let reconciled = 0
  for (const m of candidates) {
    const match = map.get(String(m.dossier_number))
    if (!match) continue
    const res = await markInvoicedOK(sb, m.id, `Déjà facturé avec numéro d'accord ${match.numAccord}`, actorId)
    if (res.ok) reconciled++
    details.push({ dossier: m.dossier_number, numAccord: match.numAccord, mission: m.id, ok: res.ok, skipped: res.skipped })
  }
  return { scanned: candidates.length, reconciled, details }
}
