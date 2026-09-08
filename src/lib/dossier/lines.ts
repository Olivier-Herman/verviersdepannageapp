// src/lib/dossier/lines.ts
//
// Les LIGNES de facturation d'une action (REM / DSP / REL…), telles que le
// module Facturation les pousse dans Odoo : brouillon persistant > montants
// forcés > moteur Siabis (SNC / SC, séparé du moteur général) > estimation.
// Partagées entre la Vue dossier (affichage des montants) et la facturation par
// dossier, pour qu'un montant affiché soit TOUJOURS celui qui sera facturé.
// Olivier 07/09/2026 : « 1WHP683, Siabis non couvert bien calculé dans la fiche
// mais apparaît à 0 dans le dossier » — le dossier n'appelait pas le moteur Siabis.

import { estimateMissionPrice }     from '@/lib/missions/estimate-price'
import { buildLinesFromEstimate, buildOverrideLines } from '@/lib/missions/build-quote-lines'
import type { QuoteLine }           from '@/lib/odoo-quote'
import { createAdminClient }        from '@/lib/supabase'

// Lignes Siabis (SNC / SC) : moteur séparé, comme dans le devis groupé.
export async function sncLines(mission: any): Promise<QuoteLine[] | null> {
  const isSiabis = mission.source === 'police_snc' || mission.source === 'sia_couvert'
  if (!isSiabis || !mission.snc_scenario) return null
  const variant = mission.source === 'sia_couvert' ? 'sc' : 'snc'
  const { computeSncMetrics, buildSncQuoteLines } = await import('@/lib/snc/pricing')
  const stops = (Array.isArray(mission.extra_addresses) ? [...mission.extra_addresses] : [])
    .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((x: any) => ({ lat: x.lat, lng: x.lng, label: x.label || x.address }))
  const metrics = await computeSncMetrics({
    scenario: mission.snc_scenario, requiresBalisage: Boolean(mission.snc_requires_balisage),
    interventionLat: mission.incident_lat, interventionLng: mission.incident_lng,
    destinationLat: mission.destination_lat, destinationLng: mission.destination_lng,
    interventionAt: mission.intervention_date || mission.received_at,
    variant, billedToId: mission.billed_to_id, billedToName: mission.billed_to_name, stops,
  } as any)
  if (!metrics) return null
  const missionRef = mission.external_id || mission.dossier_number || `M-${String(mission.id).slice(0, 8)}`
  return buildSncQuoteLines({ metrics, requiresBalisage: Boolean(mission.snc_requires_balisage), missionRef, variant })
    .map(l => ({ kind: l.kind as any, name: l.name, qty: l.qty, price_unit: l.price_unit }))
}

// Lignes d'une ACTION (REM / DSP / REL…) : brouillon persistant > montants
// forcés > Siabis > estimation. Le gardiennage est retiré quand le dossier a
// ses propres groupes gardiennage (il ne doit pas être compté deux fois).
export async function actionLines(mission: any, draftLines: any[] | undefined, dropParc: boolean): Promise<{ lines: QuoteLine[]; has_tariff: boolean; reason?: string }> {
  const VALID = ['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV']
  let lines: QuoteLine[] | null = null
  if (draftLines?.length) {
    lines = draftLines.map((l: any) => ({
      kind: (VALID.includes(l.kind) ? l.kind : 'SERV-DIV') as any,
      name: String(l.name || ''), qty: Number(l.qty || 0), price_unit: Number(l.price_unit || 0),
    })).filter(l => l.name && l.qty > 0)
  }
  if (!lines) lines = (buildOverrideLines(mission, { sncDetail: true }) as QuoteLine[] | null) || null
  if (!lines) lines = await sncLines(mission)
  if (!lines) {
    const est = await estimateMissionPrice(mission)
    if (!est.ok) return { lines: [], has_tariff: false, reason: est.reason }
    lines = buildLinesFromEstimate(est, mission)
    // Tarif trouvé mais rien à facturer : on explique POURQUOI plutôt que
    // « tarif introuvable » (2ERT632, 08/09/2026 : relivraison livrée à
    // l'adresse du parc → 0 km → 0 €).
    if (!lines.length) {
      const sameAddr = mission.incident_address && mission.destination_address && String(mission.incident_address).trim().toLowerCase() === String(mission.destination_address).trim().toLowerCase()
      const reason = Number(est.km_charged || 0) === 0 && /reliv/i.test(String(mission.mission_type || ''))
        ? `0 km : l'adresse de livraison${sameAddr ? ' est celle du départ (le parc)' : ' n\u2019est pas calculable'} — corrige « Livrer à » sur la fiche`
        : `montant calculé à 0 € (${est.breakdown?.[0]?.note || 'forfait 0, aucun km'})`
      return { lines: [], has_tariff: false, reason }
    }
  }
  if (dropParc) lines = lines.filter(l => l.kind !== 'SERV-PARC')
  // D2 (audit 08/09/2026) : ce qu'une facture partielle du module classique a
  // déjà réglé ne repart pas. Postes ponctuels facturés → retirés ; jours de
  // parc facturés → déduits de la quantité (seulement si le dossier n'a pas
  // ses groupes gardiennage, sinon le parc est géré par eux).
  if (mission.id) {
    try {
      const sb = createAdminClient()
      const { data: billed } = await sb.from('mission_billed_items').select('kind, qty, amount_htva, dossier_letter').eq('mission_id', mission.id)
      const items = (billed || []).filter((b: any) => !b.dossier_letter)   // les postes issus du dossier couvrent déjà tout le groupe
      if (items.length) {
        const oneOff = new Set(items.filter((b: any) => b.kind !== 'SERV-PARC' && Number(b.amount_htva) > 0).map((b: any) => b.kind))
        lines = lines.filter(l => !oneOff.has(l.kind))
        const parcDays = items.filter((b: any) => b.kind === 'SERV-PARC').reduce((s: number, b: any) => s + Number(b.qty || 0), 0)
        if (parcDays > 0) lines = lines.map(l => l.kind === 'SERV-PARC' ? { ...l, qty: Math.max(0, l.qty - parcDays), name: `${l.name} (dont ${parcDays} déjà facturés)` } : l).filter(l => l.qty > 0)
      }
    } catch {}
  }
  // Avances de fonds liées à la fiche : une ligne SERV-DIV chacune (même règle
  // que la modale Facturer). Le devis groupé les oubliait. Olivier 07/09/2026.
  if (mission.id && !lines.some(l => /^Avance de fonds/i.test(l.name))) {
    try {
      const sb = createAdminClient()
      const { data: adv } = await sb.from('fund_advances').select('id, plate, amount_htva, created_at').eq('mission_id', mission.id)
      for (const a of adv || []) {
        lines.push({ kind: 'SERV-DIV' as any, name: `Avance de fonds — ${(a as any).plate || mission.vehicle_plate || ''}${(a as any).created_at ? ' du ' + new Date((a as any).created_at).toLocaleDateString('fr-BE') : ''}`, qty: 1, price_unit: Number((a as any).amount_htva) || 0 })
      }
    } catch {}
  }
  return { lines, has_tariff: true }
}


export const linesTotal = (lines: QuoteLine[]) => Math.round(lines.reduce((s, l) => s + l.qty * l.price_unit, 0) * 100) / 100
