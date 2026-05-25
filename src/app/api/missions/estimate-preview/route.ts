// src/app/api/missions/estimate-preview/route.ts
//
// POST /api/missions/estimate-preview
// Body : {
//   source:         string  // ex 'touring', 'ethias', 'prive', 'aginsurance', ...
//   mission_type:   string  // 'DSP', 'REM', 'REL', 'DPR', 'Transport', 'VR', 'REM+REL'
//   distance_km:    number | null
//   intervention_at: string ISO date (optionnel, default now)
//   client_name:    string | null  (pour matching des regles dynamiques)
//   incident_type:  string | null  (optionnel)
// }
//
// Preview tarif pour /dispatch/new sur les sources NON-Siabis et NON-Police
// (assurances classiques, prive, garage). Reutilise estimateMissionPrice
// avec un MissionLike ephemere (pas d insertion BDD). Pour les sources
// Siabis (police_snc / sia_couvert) utiliser /api/snc-preview-tarif a la
// place (calcul specifique avec depots multiples et balisage).
//
// Acces : tout user authentifie.

import { NextResponse }         from 'next/server'
import { getServerSession }     from 'next-auth'
import { authOptions }          from '@/lib/auth'
import { estimateMissionPrice } from '@/lib/missions/estimate-price'

export const dynamic     = 'force-dynamic'
export const maxDuration = 15

const TVA_RATE = 0.21

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const source       = String(body.source || '').trim().toLowerCase()
  const missionType  = String(body.mission_type || '').trim()
  // distance_km : legacy (meme valeur pour charged/total).
  // total_km / charged_km : nouveau, exposes separement pour que le code
  // applique le bon selon tariff.km_basis (Olivier 2026-05-25 : "les km
  // doivent inclure les stops intermediaires + la boucle aller-retour
  // depot pour Police Accident").
  const distanceKm   = body.distance_km != null ? Number(body.distance_km) : null
  const totalKm      = body.total_km    != null ? Number(body.total_km)    : null
  const chargedKm    = body.charged_km  != null ? Number(body.charged_km)  : null
  const interventionAt = body.intervention_at || new Date().toISOString()
  const clientName   = body.client_name || null
  const incidentType = body.incident_type || null
  const vehicleClass = body.vehicle_class === 'moto' ? 'moto' : 'car'

  if (!source) return NextResponse.json({ ok: false, error: 'source manquant' }, { status: 400 })
  if (!missionType) return NextResponse.json({ ok: false, error: 'mission_type manquant' }, { status: 400 })

  const estimate = await estimateMissionPrice({
    source,
    mission_type:      missionType,
    client_name:       clientName,
    vehicle_mileage:   null,
    intervention_date: interventionAt,
    received_at:       interventionAt,
    incident_type:     incidentType,
    distance_km:       distanceKm,
    total_km:          totalKm,
    charged_km:        chargedKm,
    vehicle_class:     vehicleClass,
  })

  if (!estimate.ok) {
    return NextResponse.json({
      ok:     false,
      error:  estimate.reason || `Aucun tarif ${source}/${missionType} en vigueur`,
    })
  }

  // Construit des lignes synthetiques cote UI a partir du breakdown.
  // Le total_eur du estimate est HTVA (tous les calculs source_tariffs sont HT).
  const totalHtva = estimate.total_eur
  const totalTvac = Math.round(totalHtva * (1 + TVA_RATE) * 100) / 100

  const lines: Array<{ name: string; qty: number; price_unit: number; kind?: string }> = []

  if (estimate.pricing_mode === 'lines' && Array.isArray(estimate.template_lines)) {
    // Mode 'lines' (Police Accident, Saisie, etc.) : on expose chaque ligne
    // pre-configuree (PCD/TD/KIL/MOE/ECOPERLE/Gardiennage) avec sa qty et son PU.
    // Les lignes avec qty=null (a saisir) sont affichees avec qty=0. Le UI
    // utilise le `kind` pour afficher le PU avec son unite (jour/km/u) plutot
    // que "0.00 EUR" qui donne l impression d une ligne vide.
    for (const tl of estimate.template_lines) {
      if (tl.default_price == null) continue
      const qty = tl.default_qty != null ? Number(tl.default_qty) : 0
      lines.push({
        name:       tl.name,
        qty,
        price_unit: Number(tl.default_price),
        kind:       tl.kind,
      })
    }
  } else {
    // Mode 'forfait' / 'brackets' : breakdown synthetique
    if (estimate.forfait && estimate.forfait > 0) {
      lines.push({ name: 'Forfait', qty: 1, price_unit: estimate.forfait })
    }
    if (estimate.km_extra > 0 && estimate.km_extra_eur > 0) {
      const pu = estimate.km_extra_eur / estimate.km_extra
      lines.push({
        name:       `Km supplémentaires (${estimate.km_extra} km au-delà de ${estimate.km_inclus} inclus)`,
        qty:        estimate.km_extra,
        price_unit: Math.round(pu * 100) / 100,
      })
    }
  }

  // Ligne Majoration (toujours derniere) pour les 3 modes
  if (estimate.surcharge_pct > 0 && estimate.surcharge_eur > 0) {
    lines.push({
      name:       `Majoration ${estimate.surcharge_pct}%`,
      qty:        1,
      price_unit: Math.round(estimate.surcharge_eur * 100) / 100,
    })
  }

  return NextResponse.json({
    ok:         true,
    total_htva: Math.round(totalHtva * 100) / 100,
    total_tvac: totalTvac,
    tva_rate:   TVA_RATE,
    lines,
    breakdown:  estimate.breakdown,
    pricing_mode: estimate.pricing_mode,
    is_autofac:   estimate.is_autofac,
  })
}
