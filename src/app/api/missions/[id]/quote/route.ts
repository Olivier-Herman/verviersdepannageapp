// src/app/api/missions/[id]/quote/route.ts
//
// POST /api/missions/[id]/quote
//   - Calcule le devis (forfait + km + parc + surcharges) via estimateMissionPrice
//   - Cree ou met a jour un sale.order Odoo via lib/odoo-quote
//   - Stocke odoo_quote_id + odoo_quote_url + odoo_quoted_at sur la mission
//   - Idempotent : si la mission a deja un odoo_quote_id, on UPDATE
//
// Acces : admin / superadmin / module 'facturation'.
// Cf [[facturation-phase2]] pour la vision.

import { NextResponse }          from 'next/server'
import { getServerSession }      from 'next-auth'
import { authOptions }           from '@/lib/auth'
import { createAdminClient }     from '@/lib/supabase'
import { estimateMissionPrice }  from '@/lib/missions/estimate-price'
import { createSaleOrder, updateSaleOrder, findFleetVehicleByPlate, QuoteNotFoundError, type QuoteLine, type QuoteSection } from '@/lib/odoo-quote'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

function fmtEur(n: number): string {
  return `${n.toFixed(2).replace('.', ',')} €`
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation')) {
    return NextResponse.json({ error: 'Accès réservé à la facturation.' }, { status: 403 })
  }

  // Body optionnel : { lines: [{ kind, name, qty, price_unit }] }
  // Si fourni, on saute le calcul auto et on pousse ces lignes telles quelles.
  const body = await req.json().catch(() => ({}))
  let customLines: QuoteLine[] | null = Array.isArray(body.lines) && body.lines.length > 0
    ? body.lines.map((l: any): QuoteLine => ({
        kind:       (['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV'].includes(l.kind) ? l.kind : 'SERV-DIV') as any,
        name:       String(l.name || ''),
        qty:        Number(l.qty || 0),
        price_unit: Number(l.price_unit || 0),
      })).filter((l: QuoteLine) => l.name && l.qty > 0)
    : null

  const sb = createAdminClient()

  // Si pas de customLines dans le body, on lit le brouillon persistant en BDD
  // (l employe a peut-etre fait des modifs + sauvegarde mais ferme le modal
  // avant de pousser, ou pousse depuis un autre flow qui ne forward pas les lines).
  if (!customLines) {
    const { data: draft } = await sb
      .from('mission_invoice_drafts')
      .select('lines')
      .eq('mission_id', params.id)
      .maybeSingle()
    if (draft?.lines && Array.isArray(draft.lines) && draft.lines.length > 0) {
      customLines = draft.lines.map((l: any): QuoteLine => ({
        kind:       (['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV'].includes(l.kind) ? l.kind : 'SERV-DIV') as any,
        name:       String(l.name || ''),
        qty:        Number(l.qty || 0),
        price_unit: Number(l.price_unit || 0),
      })).filter((l: QuoteLine) => l.name && l.qty > 0)
      console.log(`[quote] Draft persistant utilise pour mission ${params.id} (${customLines.length} lignes)`)
    }
  }
  const { data: mission, error: missionErr } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, source, mission_type, status,
      client_name, vehicle_plate, vehicle_mileage,
      parked_at, intervention_date, received_at, incident_type, parent_mission_id,
      billed_to_id, billed_to_name,
      odoo_quote_id, odoo_quote_url
    `)
    .eq('id', params.id)
    .single()

  if (missionErr || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  if (!mission.billed_to_id) {
    return NextResponse.json({
      error: `Pas de client à facturer renseigné sur la mission (billed_to_id manquant). Renseigne-le d'abord sur la fiche dispatch.`,
    }, { status: 400 })
  }

  const missionRef = mission.external_id || mission.dossier_number || `M-${mission.id.slice(0, 8)}`

  // Si l employe a personnalise les lignes cote UI, on les utilise directement.
  let lines: QuoteLine[] = []
  let totalForResponse = 0

  if (customLines) {
    lines = customLines
    totalForResponse = customLines.reduce((s, l) => s + l.qty * l.price_unit, 0)
  } else if (mission.source === 'police_snc' && (mission as any).snc_scenario) {
    // SNC : tarification specifique (SIAREM/SIAKIL/SIABAL + MAJ si plage horaire).
    // Calcule les metrics si pas deja en BDD.
    const { computeSncMetrics, buildSncQuoteLines } = await import('@/lib/snc/pricing')
    const metrics = await computeSncMetrics({
      scenario:          (mission as any).snc_scenario,
      requiresBalisage:  Boolean((mission as any).snc_requires_balisage),
      interventionLat:   (mission as any).incident_lat,
      interventionLng:   (mission as any).incident_lng,
      destinationLat:    (mission as any).destination_lat,
      destinationLng:    (mission as any).destination_lng,
      interventionAt:    mission.intervention_date || mission.received_at,
    })
    if (metrics) {
      const sncLines = buildSncQuoteLines({
        metrics,
        requiresBalisage:  Boolean((mission as any).snc_requires_balisage),
        missionRef,
      })
      lines = sncLines.map(l => ({
        kind:       l.kind as any,
        name:       l.name,
        qty:        l.qty,
        price_unit: l.price_unit,
      }))
      totalForResponse = sncLines.reduce((s, l) => s + l.qty * l.price_unit, 0)
    } else {
      totalForResponse = 0  // pas de coordonnees -> devis shell
    }
  } else {
    // 1) Calcule le devis via le module estimate-price existant.
    //    Si pas de tarif applicable, on pousse un devis SHELL (sans lignes) :
    //    l employe completera les lignes manuellement dans Odoo. L app sert
    //    au moins a pre-remplir partner + ref dossier + vehicule.
    const estimate = await estimateMissionPrice(mission as any)
    if (!estimate.ok) {
      // Pas de tarif -> devis vide (shell), on saute le calcul des lignes
      totalForResponse = 0
    } else {
    totalForResponse = estimate.total_eur

  // 2) Construit les lignes a partir du breakdown

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
    }  // fin else (estimate.ok)
  }  // fin else (pas de customLines)

  // Note : on accepte de pousser un devis VIDE (lines=[]) si pas de tarif et
  // pas de customLines. L employe completera dans Odoo (cf Olivier 2026-05-20).

  // 3) Lookup fleet.vehicle Odoo par plaque (optionnel, best-effort)
  let fleetVehicleId: number | null = null
  if (mission.vehicle_plate) {
    fleetVehicleId = await findFleetVehicleByPlate(mission.vehicle_plate)
  }

  // 4) Push Odoo (create ou update selon idempotence)
  const sections: QuoteSection[] = [{ lines }]
  const commonInput = {
    partner_id:       mission.billed_to_id as number,
    origin:           missionRef,
    client_order_ref: mission.dossier_number || undefined,
    fleet_vehicle_id: fleetVehicleId,
    sections,
  }

  let result: { id: number; url: string }
  try {
    if (mission.odoo_quote_id) {
      try {
        result = await updateSaleOrder(mission.odoo_quote_id, commonInput)
      } catch (e: any) {
        if (e instanceof QuoteNotFoundError) {
          // Devis stocke en BDD mais supprime cote Odoo -> on recree from scratch
          console.warn(`[quote] Devis ${mission.odoo_quote_id} introuvable, recreate from scratch`)
          result = await createSaleOrder(commonInput)
        } else {
          throw e
        }
      }
    } else {
      result = await createSaleOrder(commonInput)
    }
  } catch (e: any) {
    console.error('[quote] Odoo push failed:', e.message)
    return NextResponse.json({ error: `Erreur Odoo : ${e.message}` }, { status: 500 })
  }

  // 5) Persiste la trace cote VD Soft
  const { error: updErr } = await sb
    .from('incoming_missions')
    .update({
      odoo_quote_id:  result.id,
      odoo_quote_url: result.url,
      odoo_quoted_at: new Date().toISOString(),
    })
    .eq('id', mission.id)

  if (updErr) {
    console.error('[quote] update mission failed:', updErr.message)
    // On a deja cree/maj le devis Odoo, on retourne quand meme l info
  }

  return NextResponse.json({
    ok:    true,
    quote: { id: result.id, url: result.url },
    summary: {
      mission_ref:   missionRef,
      partner_id:    mission.billed_to_id,
      partner_name:  mission.billed_to_name,
      total_eur:     totalForResponse,
      lines_count:   lines.length,
      total_label:   fmtEur(totalForResponse),
    },
  })
}
