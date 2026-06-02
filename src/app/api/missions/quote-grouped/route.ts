// src/app/api/missions/quote-grouped/route.ts
//
// POST /api/missions/quote-grouped
// Body: { mission_ids: string[] }
//
// Cree (ou met a jour) UN seul sale.order Odoo pour plusieurs missions d une
// meme chaine (REM + REL, ou autres groupes). Les missions doivent partager
// le meme partner_id (billed_to_id). Chaque mission devient une SECTION dans
// le devis (display_type='line_section') pour la lisibilite.
//
// Usage type : Touring facture REM + REL en 1 seul devis avec sections.
//
// Acces : admin / superadmin / module 'facturation'.

import { NextResponse }          from 'next/server'
import { getServerSession }      from 'next-auth'
import { authOptions }           from '@/lib/auth'
import { createAdminClient }     from '@/lib/supabase'
import { estimateMissionPrice }  from '@/lib/missions/estimate-price'
import { buildLinesFromEstimate } from '@/lib/missions/build-quote-lines'
import { createSaleOrder, updateSaleOrder, findFleetVehicleByPlate, QuoteNotFoundError, type QuoteSection } from '@/lib/odoo-quote'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

/** Determine le type de mission (REM/REL/DSP/DPR) pour le label de section. */
function missionKind(m: any): string {
  const it = (m.incident_type || '').toLowerCase()
  const mt = (m.mission_type   || '').toLowerCase()
  if (it === 'relivraison' || mt === 'relivraison' || m.parent_mission_id) return 'REL'
  if (it === 'dpr')                                                         return 'DPR'
  if (mt === 'remorquage')                                                  return 'REM'
  if (['depannage', 'reparation_place', 'trajet_vide'].includes(mt))        return 'DSP'
  return 'AUTRE'
}

/**
 * Description longue par type de mission, pour la section du devis Odoo.
 * Les placeholders "Lieu d'intervention" et "Lieu de destination" sont
 * remplaces par les vraies adresses de la mission.
 */
function kindDescription(kind: string, mission: any, allMissions?: any[]): string {
  const lieuIntervention = mission.incident_address || "Lieu d'intervention"
  const lieuDestination  = mission.destination_address || mission.destination_name || "Lieu de destination"

  // REM est consideree "mise en depot" si l un des cas suivants :
  //   1. parked_at non null (la voiture a transite par le parc)
  //   2. Une REL liee existe dans le devis (parent_mission_id = REM)
  //   3. Pas d adresse destination du tout (REM "ouverte", typiquement Mal Garee
  //      ou cas police, ou REM enregistree avant de connaitre la destination)
  let isPutInDepot = Boolean(mission.parked_at)
  if (!isPutInDepot && Array.isArray(allMissions)) {
    isPutInDepot = allMissions.some(m =>
      m.id !== mission.id &&
      m.parent_mission_id === mission.id &&
      (m.mission_type === 'relivraison' || m.mission_type === 'REL')
    )
  }
  if (!isPutInDepot && !mission.destination_address && !mission.destination_name) {
    isPutInDepot = true
  }

  switch (kind) {
    case 'REM':
      return isPutInDepot
        ? `Remorquage d'un véhicule dont référence ci-dessus de "${lieuIntervention}" à notre dépôt`
        : `Remorquage d'un véhicule dont référence ci-dessus de "${lieuIntervention}" à "${lieuDestination}"`
    case 'REL':
      return `Relivraison d'un véhicule dont référence ci-dessus de notre dépôt vers "${lieuDestination}"`
    case 'DSP':
      return `Dépannage d'un véhicule dont référence ci-dessus à "${lieuIntervention}"`
    case 'DPR':
      return "Déplacement protocolaire d'un véhicule dont référence ci-dessus"
    default:
      return ''
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation')) {
    return NextResponse.json({ error: 'Accès réservé à la facturation.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const missionIds: string[] = Array.isArray(body.mission_ids) ? body.mission_ids : []
  if (missionIds.length < 2) {
    return NextResponse.json({ error: 'Au moins 2 mission_ids requis pour un devis groupé.' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: missions, error: missionErr } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, source, mission_type, status,
      client_name, vehicle_plate, vehicle_mileage,
      parked_at, intervention_date, received_at, incident_type, parent_mission_id,
      billed_to_id, billed_to_name,
      amount_to_collect, special_tarif_htva,
      incident_address, incident_city, destination_address, destination_name,
      odoo_quote_id, odoo_quote_url
    `)
    .in('id', missionIds)

  // Charge les brouillons persistants des lignes pour chaque mission (si l employe
  // a fait des modifs manuelles via FacturerModal et sauvegarde).
  const { data: drafts } = await sb
    .from('mission_invoice_drafts')
    .select('mission_id, lines')
    .in('mission_id', missionIds)
  const draftByMissionId = new Map<string, any[]>()
  for (const d of drafts || []) {
    if (Array.isArray(d.lines) && d.lines.length > 0) {
      draftByMissionId.set(d.mission_id, d.lines)
    }
  }

  if (missionErr || !missions || missions.length === 0) {
    return NextResponse.json({ error: 'Missions introuvables' }, { status: 404 })
  }

  if (missions.length !== missionIds.length) {
    return NextResponse.json({
      error: `Seulement ${missions.length}/${missionIds.length} missions trouvées en BDD.`,
    }, { status: 400 })
  }

  // 1. Vérifie que toutes les missions partagent le même partner_id.
  const billedTos = new Set(missions.map(m => m.billed_to_id).filter(Boolean))
  if (missions.some(m => !m.billed_to_id)) {
    return NextResponse.json({
      error: `Une ou plusieurs missions n'ont pas de client à facturer (billed_to_id manquant).`,
    }, { status: 400 })
  }
  if (billedTos.size > 1) {
    return NextResponse.json({
      error: `Les missions de la chaîne ont des clients différents (${Array.from(billedTos).join(', ')}). Crée un devis par client séparément.`,
    }, { status: 400 })
  }
  const partnerId = missions[0].billed_to_id as number

  // 2. Détecte si une mission a déjà un devis individuel (autre que le groupé)
  //    -> on refuse pour éviter doublons. L'employé doit gérer manuellement.
  const existingQuoteIds = new Set(missions.map(m => m.odoo_quote_id).filter(Boolean))
  if (existingQuoteIds.size > 1) {
    return NextResponse.json({
      error: `Plusieurs missions de la chaîne ont déjà des devis distincts (${Array.from(existingQuoteIds).join(', ')}). Supprime-les d'abord côté Odoo pour créer un devis groupé.`,
    }, { status: 409 })
  }
  // Si existingQuoteIds.size === 1 : on update ce devis avec les nouvelles sections.
  const existingQuoteId = existingQuoteIds.size === 1
    ? (Array.from(existingQuoteIds)[0] as number)
    : null

  // 3. Trie les missions : parent d'abord (parent_mission_id null), puis enfants par date.
  const sortedMissions = [...missions].sort((a, b) => {
    const aIsParent = !a.parent_mission_id
    const bIsParent = !b.parent_mission_id
    if (aIsParent && !bIsParent) return -1
    if (!aIsParent && bIsParent) return 1
    return (a.received_at || '').localeCompare(b.received_at || '')
  })

  // 4. Pour chaque mission, construit une section avec ses lignes.
  const sections: QuoteSection[] = []
  let totalForResponse = 0
  const sectionStats: Array<{ mission_id: string; kind: string; ref: string; lines_count: number; has_tariff: boolean }> = []

  for (const mission of sortedMissions) {
    const kind = missionKind(mission)
    const ref = mission.external_id || mission.dossier_number || mission.id.slice(0, 8)
    const desc = kindDescription(kind, mission, sortedMissions)
    const sectionLabel = desc
      ? `${kind} #${ref} — ${desc}`
      : `${kind} #${ref}`

    // Priorite au draft persistant (l employe a modifie + sauvegarde)
    const draftLines = draftByMissionId.get(mission.id)
    if (draftLines) {
      const lines = draftLines.map((l: any) => ({
        kind:       (['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV'].includes(l.kind) ? l.kind : 'SERV-DIV'),
        name:       String(l.name || ''),
        qty:        Number(l.qty || 0),
        price_unit: Number(l.price_unit || 0),
      })).filter((l: any) => l.name && l.qty > 0)
      sections.push({ section_label: sectionLabel, lines })
      totalForResponse += lines.reduce((s: number, l: any) => s + l.qty * l.price_unit, 0)
      sectionStats.push({ mission_id: mission.id, kind, ref, lines_count: lines.length, has_tariff: true })
      console.log(`[quote-grouped] Draft persistant utilise pour mission ${mission.id} (${lines.length} lignes)`)
      continue
    }

    // Sinon : calcul auto via estimate-price
    const estimate = await estimateMissionPrice(mission as any)
    if (estimate.ok) {
      const lines = buildLinesFromEstimate(estimate, mission)
      sections.push({ section_label: sectionLabel, lines })
      totalForResponse += estimate.total_eur
      sectionStats.push({ mission_id: mission.id, kind, ref, lines_count: lines.length, has_tariff: true })
    } else {
      // Pas de tarif : section vide (juste le label) — Olivier completera dans Odoo
      sections.push({ section_label: `${sectionLabel} (à compléter)`, lines: [] })
      sectionStats.push({ mission_id: mission.id, kind, ref, lines_count: 0, has_tariff: false })
    }
  }

  // 5. Lookup fleet.vehicle Odoo pour le premier véhicule (les chaînes REM+REL
  //    ont le même véhicule).
  const firstWithPlate = sortedMissions.find(m => m.vehicle_plate)
  let fleetVehicleId: number | null = null
  if (firstWithPlate?.vehicle_plate) {
    fleetVehicleId = await findFleetVehicleByPlate(firstWithPlate.vehicle_plate)
  }

  // 6. Push Odoo (create ou update)
  const parent = sortedMissions[0]
  const originRef = parent.external_id || parent.dossier_number || `M-${parent.id.slice(0, 8)}`
  const input = {
    partner_id:       partnerId,
    origin:           originRef,
    client_order_ref: parent.dossier_number || undefined,
    fleet_vehicle_id: fleetVehicleId,
    sections,
  }

  let result: { id: number; url: string }
  try {
    if (existingQuoteId) {
      try {
        result = await updateSaleOrder(existingQuoteId, input)
      } catch (e) {
        if (e instanceof QuoteNotFoundError) {
          console.warn(`[quote-grouped] Devis ${existingQuoteId} introuvable, recreate`)
          result = await createSaleOrder(input)
        } else throw e
      }
    } else {
      result = await createSaleOrder(input)
    }
  } catch (e: any) {
    console.error('[quote-grouped] Odoo push failed:', e.message)
    return NextResponse.json({ error: `Erreur Odoo : ${e.message}` }, { status: 500 })
  }

  // 7. Update toutes les missions de la chaîne avec le même quote_id
  const updPayload = {
    odoo_quote_id:  result.id,
    odoo_quote_url: result.url,
    odoo_quoted_at: new Date().toISOString(),
  }
  await sb.from('incoming_missions').update(updPayload).in('id', missionIds)

  return NextResponse.json({
    ok:       true,
    quote:    { id: result.id, url: result.url },
    summary:  {
      missions_count: sortedMissions.length,
      total_eur:      totalForResponse,
      sections:       sectionStats,
    },
  })
}
