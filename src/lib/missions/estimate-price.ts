// src/lib/missions/estimate-price.ts
//
// Helper pour estimer le prix d'une mission selon :
//   - le tarif source_tariffs en vigueur (source + mission_type)
//   - la distance parcourue (si applicable)
//   - les majorations contextuelles (nuit/WE/JF) via getApplicableSurcharges
//
// Retourne un breakdown structure utilisable cote UI.

import { createAdminClient } from '@/lib/supabase'
import { getApplicableSurcharges, isBelgianHoliday } from '@/lib/surcharges'
import { normalizeType, isRemorquage, isDsp, isTrajetVide } from '@/lib/missions/mission-types'

export interface PriceEstimate {
  ok:            boolean
  reason?:       string  // si pas de tarif trouve
  source:        string  // source utilisee pour le lookup
  mission_type:  string  // type canonical
  forfait:       number | null
  km_total:      number  // km total estime (vehicle_mileage ou null)
  km_inclus:     number
  km_extra:      number  // max(0, km_total - km_inclus)
  km_extra_eur:  number  // km_extra * km_price
  parc_jours:    number
  parc_eur:      number
  subtotal_eur:  number  // forfait + km_extra_eur + parc_eur
  surcharge_pct: number  // % de majoration applicable (0 si rien)
  surcharge_eur: number  // subtotal * surcharge_pct / 100
  total_eur:     number  // subtotal + surcharge_eur
  is_autofac:    boolean // si autofacturation (info pour dispatcher)
  tariff_id:     string  // id du source_tariff utilise
  tariff_doc_path: string | null
  tariff_doc_name: string | null
  breakdown:     { label: string; amount: number | null; note?: string }[]
}

interface MissionLike {
  id?:                string
  source:             string | null
  mission_type:       string | null
  client_name:        string | null
  vehicle_mileage:    number | null
  parked_at?:         string | null
  intervention_date?: string | null
  received_at?:       string | null
  incident_type?:     string | null
  parent_mission_id?: string | null
}

/** Map mission_type DB vers le canonical attendu en source_tariffs (lowercase). */
function canonicalType(t: string | null): string | null {
  if (isRemorquage(t)) return 'remorquage'
  if (isDsp(t))         return 'depannage'
  if (isTrajetVide(t))  return 'trajet_vide'
  if (!t) return null
  return normalizeType(t)
}

export async function estimateMissionPrice(mission: MissionLike): Promise<PriceEstimate> {
  const source = (mission.source || '').toLowerCase().trim()
  const missionType = canonicalType(mission.mission_type)

  if (!source || !missionType) {
    return emptyEstimate(source, missionType || 'inconnu', 'Source ou type mission manquant')
  }

  const sb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // 1. Lookup le tarif en vigueur (effective_from <= today, effective_to >= today ou null).
  //    Si plusieurs lignes, prend la plus recente (effective_from DESC).
  const { data: tariffs } = await sb
    .from('source_tariffs')
    .select('*')
    .eq('source', source)
    .eq('mission_type', missionType)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order('effective_from', { ascending: false })
    .limit(1)

  const tariff = tariffs?.[0]
  if (!tariff) {
    return emptyEstimate(source, missionType, `Aucun tarif ${source}/${missionType} en vigueur`)
  }

  // 2. Calcul forfait + km extra
  const forfait = Number(tariff.unit_price || 0)
  const kmTotal = Number(mission.vehicle_mileage || 0)
  const kmInclus = Number(tariff.km_inclus || 0)
  const kmExtra = Math.max(0, kmTotal - kmInclus)
  const kmExtraEur = kmExtra * Number(tariff.km_price || 0)

  // 3. Calcul parc si parked_at est set
  let parcJours = 0
  let parcEur = 0
  if (mission.parked_at && tariff.parc_day_price) {
    const parcStart = new Date(mission.parked_at)
    const parcEnd = new Date()
    const diffMs = Math.max(0, parcEnd.getTime() - parcStart.getTime())
    parcJours = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    parcEur = parcJours * Number(tariff.parc_day_price || 0)
  }

  const subtotal = forfait + kmExtraEur + parcEur

  // 4. Majorations via module surcharges
  let surchargePct = 0
  let surchargeNote = ''
  const interventionDateStr = mission.intervention_date || mission.received_at
  if (interventionDateStr) {
    const interventionDate = new Date(interventionDateStr)
    try {
      const applicable = await getApplicableSurcharges({
        source: mission.source,
        client_name: mission.client_name,
        mission_type: mission.mission_type,
        incident_type: mission.incident_type || null,
        parent_mission_id: mission.parent_mission_id || null,
      }, interventionDate)
      if (applicable.length > 0) {
        // Cumul des taux applicables (en general 1 seul mais on cumule par safety)
        surchargePct = applicable.reduce((sum, s) => sum + Number(s.rate_pct || 0), 0)
        surchargeNote = applicable.map(s => `${s.weekday_label} ${s.range_label} +${s.rate_pct}%`).join(', ')
      }
    } catch (e: any) {
      console.warn('[estimate-price] surcharges error (non bloquant):', e.message)
    }
  }

  const surchargeEur = (subtotal * surchargePct) / 100
  const total = subtotal + surchargeEur

  const breakdown = [
    { label: 'Forfait',   amount: forfait, note: kmInclus > 0 ? `${kmInclus} km inclus` : undefined },
    { label: 'Km extra',  amount: kmExtraEur > 0 ? kmExtraEur : null, note: kmExtra > 0 ? `${kmExtra} km × ${Number(tariff.km_price || 0).toFixed(2)} €` : 'aucun' },
    { label: 'Parc',      amount: parcEur > 0 ? parcEur : null, note: parcJours > 0 ? `${parcJours} jour(s) × ${Number(tariff.parc_day_price || 0).toFixed(2)} €` : 'non applicable' },
    { label: 'Majoration', amount: surchargeEur > 0 ? surchargeEur : null, note: surchargeNote || 'aucune' },
  ]

  return {
    ok:            true,
    source,
    mission_type:  missionType,
    forfait,
    km_total:      kmTotal,
    km_inclus:     kmInclus,
    km_extra:      kmExtra,
    km_extra_eur:  kmExtraEur,
    parc_jours:    parcJours,
    parc_eur:      parcEur,
    subtotal_eur:  subtotal,
    surcharge_pct: surchargePct,
    surcharge_eur: surchargeEur,
    total_eur:     total,
    is_autofac:    Boolean(tariff.is_autofac),
    tariff_id:     tariff.id,
    tariff_doc_path: tariff.source_document_path,
    tariff_doc_name: tariff.source_document_name,
    breakdown,
  }
}

function emptyEstimate(source: string, missionType: string, reason: string): PriceEstimate {
  return {
    ok:            false,
    reason,
    source,
    mission_type:  missionType,
    forfait:       null,
    km_total:      0,
    km_inclus:     0,
    km_extra:      0,
    km_extra_eur:  0,
    parc_jours:    0,
    parc_eur:      0,
    subtotal_eur:  0,
    surcharge_pct: 0,
    surcharge_eur: 0,
    total_eur:     0,
    is_autofac:    false,
    tariff_id:     '',
    tariff_doc_path: null,
    tariff_doc_name: null,
    breakdown:     [],
  }
}
