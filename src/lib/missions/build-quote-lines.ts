// src/lib/missions/build-quote-lines.ts
//
// Helper partage : transforme une PriceEstimate (calculee via
// estimateMissionPrice) en liste de QuoteLine prete a pousser vers Odoo
// (sale.order.line). Mappe vers les 4 produits generiques SERV-PEC/KM/PARC/MAJ.
//
// Utilise par :
//   - POST /api/missions/[id]/quote (devis individuel)
//   - POST /api/missions/quote-grouped (devis groupe REM+REL)

import type { QuoteLine } from '@/lib/odoo-quote'
import type { PriceEstimate } from '@/lib/missions/estimate-price'

interface MissionLike {
  id:           string
  external_id?: string | null
  dossier_number?: string | null
  source?:      string | null
}

export function buildLinesFromEstimate(
  estimate: PriceEstimate,
  mission:  MissionLike,
): QuoteLine[] {
  const lines: QuoteLine[] = []
  const missionRef = mission.external_id || mission.dossier_number || `M-${mission.id.slice(0, 8)}`

  if (estimate.forfait && estimate.forfait > 0) {
    lines.push({
      kind:       'SERV-PEC',
      name:       `Prise en charge ${mission.source ? `(${mission.source.toUpperCase()}) ` : ''}— ${missionRef}`,
      qty:        1,
      price_unit: estimate.forfait,
    })
  }

  if (estimate.km_extra > 0 && estimate.km_extra_eur > 0) {
    const pu = estimate.km_extra_eur / estimate.km_extra
    lines.push({
      kind:       'SERV-KM',
      name:       `Km supplémentaires (${estimate.km_extra} km au-delà de ${estimate.km_inclus} inclus)`,
      qty:        estimate.km_extra,
      price_unit: Math.round(pu * 100) / 100,
    })
  }

  if (estimate.parc_jours > 0 && estimate.parc_eur > 0) {
    const pu = estimate.parc_eur / estimate.parc_jours
    lines.push({
      kind:       'SERV-PARC',
      name:       `Frais de parc (${estimate.parc_jours} jour${estimate.parc_jours > 1 ? 's' : ''})`,
      qty:        estimate.parc_jours,
      price_unit: Math.round(pu * 100) / 100,
    })
  }

  if (estimate.surcharge_pct > 0 && estimate.surcharge_eur > 0) {
    // Majoration : qty = % en decimal (ex 0.30), PU = total HT majorable
    lines.push({
      kind:       'SERV-MAJ',
      name:       `Majoration ${estimate.surcharge_pct}%`,
      qty:        Math.round(estimate.surcharge_pct) / 100,
      price_unit: Math.round(estimate.subtotal_eur * 100) / 100,
    })
  }

  return lines
}
