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
  id:                  string
  external_id?:        string | null
  dossier_number?:     string | null
  source?:             string | null
  mission_type?:       string | null
  special_tarif_htva?: number | null
  amount_guaranteed?:  number | null
  amount_to_collect?:  number | null
  // Francofolies (Phase 2) : tarification figée à l'enlèvement.
  ff_base_htva?:        number | null
  ff_gardiennage_days?: number | null
  ff_gardiennage_pu?:   number | null
}

/**
 * Olivier 2026-06-04 : helper exporte pour decider si on doit court-circuiter
 * le calcul auto par des montants forces (special_tarif OU amount_guaranteed +
 * amount_to_collect). Retourne null si rien d applicable -> on continue le
 * calcul standard. Utilise par buildLinesFromEstimate ET les routes qui
 * n appellent pas le helper (ex: SNC dans /quote, restitute, etc.).
 */
export function buildOverrideLines(mission: MissionLike): QuoteLine[] | null {
  const missionRef = mission.external_id || mission.dossier_number || `M-${mission.id.slice(0, 8)}`

  // 0. Francofolies (mal garée évènementiel) — tarification figée à l'enlèvement.
  //    Ligne SERV-DIV réquisition (PU = ff_base_htva) + ligne gardiennage si jours
  //    retenus. Passe AVANT les autres branches car amount_to_collect est aussi
  //    renseigné (total TVAC) et donnerait sinon la ligne générique. Olivier 2026-06-29.
  if (mission.source === 'francofolies') {
    const base = mission.ff_base_htva != null ? Number(mission.ff_base_htva) : 0
    const gDays = mission.ff_gardiennage_days != null ? Number(mission.ff_gardiennage_days) : 0
    const gPu   = mission.ff_gardiennage_pu  != null ? Number(mission.ff_gardiennage_pu)  : 0
    const ffLines: QuoteLine[] = []
    if (base > 0) {
      ffLines.push({
        kind:       'SERV-DIV',
        name:       `Réquisitionné par la police pour véhicule mal garé dans le cadre des Francofolies de Spa — ${missionRef}`,
        qty:        1,
        price_unit: base,
      })
    }
    if (gDays > 0 && gPu > 0) {
      ffLines.push({
        kind:       'GARDIENNAGE',
        name:       `Gardiennage (${gDays} jour${gDays > 1 ? 's' : ''})`,
        qty:        gDays,
        price_unit: gPu,
      })
    }
    if (ffLines.length > 0) return ffLines
  }

  // 1. Tarif special HTVA -> 1 seule ligne ecrase tout
  if (mission.special_tarif_htva != null && Number(mission.special_tarif_htva) > 0) {
    return [{
      kind:       'SERV-DIV',
      name:       `Intervention suivant prix convenu — ${missionRef}`,
      qty:        1,
      price_unit: Number(mission.special_tarif_htva),
    }]
  }

  // 2. Olivier 2026-06-04 : montant garanti + montant a reclamer client.
  // Si l un OU l autre OU les 2 sont definis, on genere 1 ou 2 lignes
  // (une par montant). Total = somme. Ecrase egalement le calcul auto.
  const guaranteed = mission.amount_guaranteed != null && Number(mission.amount_guaranteed) > 0
    ? Number(mission.amount_guaranteed) : 0
  const toCollect = mission.amount_to_collect != null && Number(mission.amount_to_collect) > 0
    ? Number(mission.amount_to_collect) : 0
  if (guaranteed > 0 || toCollect > 0) {
    const lines: QuoteLine[] = []
    if (guaranteed > 0) {
      lines.push({
        kind:       'SERV-DIV',
        name:       `Montant garanti — ${missionRef}`,
        qty:        1,
        price_unit: guaranteed,
      })
    }
    if (toCollect > 0) {
      // BUG fix Olivier 2026-06-17 : amount_to_collect est un montant TVAC
      // (convention app + cf estimate-price.ts). Le price_unit Odoo attend du
      // HTVA → on convertit (÷1,21, 4 décimales pour que HTVA×1,21 = TVAC exact).
      // Avant : le TVAC TowSoft était mis tel quel en HTVA → TVA comptée 2×.
      const toCollectHt = Math.round((toCollect / 1.21) * 10000) / 10000
      lines.push({
        kind:       'SERV-DIV',
        name:       `Paiement à réclamer au client — ${missionRef}`,
        qty:        1,
        price_unit: toCollectHt,
      })
    }
    return lines
  }

  return null
}

export function buildLinesFromEstimate(
  estimate: PriceEstimate,
  mission:  MissionLike,
): QuoteLine[] {
  const lines: QuoteLine[] = []
  const missionRef = mission.external_id || mission.dossier_number || `M-${mission.id.slice(0, 8)}`

  // Olivier 2026-06-02 PM + 2026-06-04 : court-circuit via montants forces
  // (tarif special OU amount_guaranteed + amount_to_collect). Helper exporte
  // buildOverrideLines() pour partager la logique avec les routes hors
  // estimate-pipeline (SNC, restitute).
  const override = buildOverrideLines(mission)
  if (override) return override

  if (estimate.pricing_mode === 'lines' && Array.isArray(estimate.template_lines)) {
    // Mode 'lines' (Police Accident, Saisie, etc.) : expose chaque ligne
    // pre-configuree (PCD/TD/KIL/MOE/ECOPERLE/Gardiennage) avec sa qty et son PU.
    // Lignes avec qty=null ou price=null ignorees (a saisir manuellement).
    for (const tl of estimate.template_lines) {
      if (tl.default_qty == null || tl.default_price == null) continue
      if (tl.default_qty <= 0 || tl.default_price <= 0) continue
      lines.push({
        kind:       tl.kind as QuoteLine['kind'],
        name:       tl.name,
        qty:        Number(tl.default_qty),
        price_unit: Number(tl.default_price),
      })
    }
  } else {
    // Mode 'forfait' / 'brackets' : breakdown synthetique
    if (estimate.forfait && estimate.forfait > 0) {
      // Olivier 2026-06-03 : pour Mal Garee deplacement_paye (source=police_mg
      // + mission_type=trajet_vide), label specifique "Déplacement pour vehicule
      // mal garé" au lieu du generique "Prise en charge (POLICE_MG)".
      const isMalGareeDeplPaye = mission.source === 'police_mg'
                              && (mission.mission_type || '').toLowerCase() === 'trajet_vide'
      const label = isMalGareeDeplPaye
        ? 'Déplacement pour véhicule mal garé'
        : `Prise en charge ${mission.source ? `(${mission.source.toUpperCase()}) ` : ''}— ${missionRef}`
      lines.push({
        kind:       'SERV-PEC',
        name:       label,
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
        // Olivier 2026-06-03 : 4 decimales (Odoo Decimal Precision configure
        // a 4 pour Product Price, utilise par tarif Saisie/Parquet et autres).
        price_unit: Math.round(pu * 10000) / 10000,
      })
    }

    if (estimate.parc_jours > 0 && estimate.parc_eur > 0) {
      const pu = estimate.parc_eur / estimate.parc_jours
      lines.push({
        kind:       'SERV-PARC',
        name:       `Frais de parc (${estimate.parc_jours} jour${estimate.parc_jours > 1 ? 's' : ''})`,
        qty:        estimate.parc_jours,
        // Olivier 2026-06-03 : 4 decimales (coherence Odoo Decimal Precision).
        price_unit: Math.round(pu * 10000) / 10000,
      })
    }
  }

  if (estimate.surcharge_pct > 0 && estimate.surcharge_eur > 0) {
    // Majoration : qty = % en decimal (ex 0.384 pour 38,4%), PU = total HT majorable.
    // Olivier 2026-06-18 : NE PAS arrondir le pourcentage a l'entier avant de
    // diviser (38,4% donnait Math.round(38.4)/100 = 0,38 au lieu de 0,384).
    lines.push({
      kind:       'SERV-MAJ',
      name:       `Majoration ${estimate.surcharge_pct}%`,
      qty:        Math.round(estimate.surcharge_pct * 100) / 10000,
      price_unit: Math.round(estimate.subtotal_eur * 100) / 100,
    })
  }

  return lines
}
