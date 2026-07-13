// src/lib/snc/amount.ts
//
// Calcul SERVEUR du montant TVAC à encaisser pour un SNC NON COUVERT selon le
// scénario. Garantit amount_to_collect indépendamment du client : dès que le
// scénario devient dsp / rem_client / rem_direct sur une fiche police_snc, le
// PATCH mission calcule et pose le montant (plus de dépendance au double appel
// fragile de l'app chauffeur). Olivier 2026-07-13 (cas 10062195).

import { computeSncMetrics, buildSncQuoteLines } from '@/lib/snc/pricing'

const TVA_RATE = 0.21
type Scenario = 'dsp' | 'rem_client' | 'rem_depot' | 'rem_direct'

/**
 * Retourne le montant TVAC à encaisser, ou null si non applicable :
 *   - variant SC (Siabis couvert) → facturé à l'assistance, pas d'encaissement.
 *   - rem_depot → encaissement au bureau, pas immédiat.
 *   - coords manquantes / dépôts non configurés / calcul KO.
 */
export async function computeSncAmountToCollect(m: {
  source:                 string | null
  incident_lat:           number | null | undefined
  incident_lng:           number | null | undefined
  destination_lat?:       number | null
  destination_lng?:       number | null
  snc_requires_balisage?: boolean | null
  intervention_date?:     string | null
  received_at?:           string | null
  extra_addresses?:       any
  billed_to_id?:          number | null
  billed_to_name?:        string | null
}, scenario: Scenario): Promise<number | null> {
  const variant = m.source === 'sia_couvert' ? 'sc' : 'snc'
  if (variant === 'sc') return null                 // couvert = pas d'encaissement client
  if (scenario === 'rem_depot') return null          // dépôt = paiement au bureau
  if (m.incident_lat == null || m.incident_lng == null) return null
  if ((scenario === 'rem_client' || scenario === 'rem_direct')
      && (m.destination_lat == null || m.destination_lng == null)) return null

  const stops = Array.isArray(m.extra_addresses)
    ? m.extra_addresses.map((s: any) => ({
        lat:   s.lat != null ? Number(s.lat) : null,
        lng:   s.lng != null ? Number(s.lng) : null,
        label: s.label || s.address || 'Stop',
      }))
    : []

  const metrics = await computeSncMetrics({
    scenario,
    requiresBalisage: Boolean(m.snc_requires_balisage),
    interventionLat:  Number(m.incident_lat),
    interventionLng:  Number(m.incident_lng),
    destinationLat:   m.destination_lat != null ? Number(m.destination_lat) : null,
    destinationLng:   m.destination_lng != null ? Number(m.destination_lng) : null,
    interventionAt:   m.intervention_date || m.received_at || new Date().toISOString(),
    variant,
    billedToId:       m.billed_to_id ?? null,
    billedToName:     m.billed_to_name ?? null,
    stops,
  })
  if (!metrics) return null

  const lines = buildSncQuoteLines({ metrics, requiresBalisage: Boolean(m.snc_requires_balisage), missionRef: 'AUTO', variant })
  const totalHtva = lines.reduce((s, l) => s + l.qty * l.price_unit, 0)
  const totalTvac = Math.round(totalHtva * (1 + TVA_RATE) * 100) / 100
  return totalTvac > 0 ? totalTvac : null
}
