// src/lib/missions/reprint-label-helper.ts
//
// Olivier 2026-06-03 : helper partage entre /api/missions/[id]/reprint-label
// et /api/helpdesk/[id]/print. Charge la mission VD Soft + applique toutes
// les regles motif/note specifiques par source + delegue a printVdSoftParcLabel.
//
// Utilise par :
//   - /api/missions/[id]/reprint-label  (accepte UUID ou mission_number)
//   - /api/helpdesk/[id]/print          (resolution via odoo_ticket_id)

import { createAdminClient }      from '@/lib/supabase'
import { printVdSoftParcLabel }   from '@/lib/missions/print-parc-label'
import { buildRelLabelZPL }       from '@/lib/print/zpl-templates/rel'
import { printZPLRaw }            from '@/lib/print/zebra-raw'

type Selector = { kind: 'uuid'; value: string }
              | { kind: 'mission_number'; value: number }
              | { kind: 'odoo_ticket_id'; value: number }

const MOTIF_LABELS: Record<string, string> = {
  'police_mg':       'MAL GAREE',
  'police_rodeo':    'RODEO',
  'police_avp':      'AVP',
  'police_accident': 'ACCIDENT',
  'police_saisie':   'SAISIE',
  'police_snc':      'SIABIS NON COUVERT',
  'sia_couvert':     'SIABIS COUVERT',
  'prive':           'APPEL PRIVE',
  // Olivier 2026-06-07 : labels courts pour les sources legacy (sinon
  // wrap sur 3+ lignes et debordent sur la zone plaque).
  'legacy_odoo':              'MIGRATION ODOO',
  'legacy_odoo_migration':    'MIGRATION ODOO',
  'legacy_towsoft_migration': 'MIGRATION TOWSOFT',
}

export async function reprintLabelForMission(
  sel: Selector,
  opts?: {
    /** Olivier 2026-06-06 PM : mention ajoutee a la note de l etiquette
     *  (ex: 'Migration VD Soft OK' pendant la migration zone-par-zone). */
    noteAppend?: string
  },
): Promise<{ ok: boolean; error?: string; mission_id?: string }> {
  const sb = createAdminClient()
  const baseQuery = sb
    .from('incoming_missions')
    .select(`
      id, mission_number, source, mission_type, intervention_date, received_at,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      destination_address, redelivery_address, snc_scenario,
      saisie_motif_code, saisie_motif_label,
      police_blocked, police_zone, officer_name,
      odoo_ticket_id,
      billed_to_name, client_name
    `)
  const { data: mission, error } =
      sel.kind === 'uuid'           ? await baseQuery.eq('id',              sel.value).maybeSingle()
    : sel.kind === 'mission_number' ? await baseQuery.eq('mission_number',  sel.value).maybeSingle()
    :                                 await baseQuery.eq('odoo_ticket_id',  sel.value).maybeSingle()

  if (error || !mission) {
    return { ok: false, error: 'Mission introuvable' }
  }

  // Motif de base
  let motif = MOTIF_LABELS[mission.source] || String(mission.source || '').toUpperCase()
  if (mission.source === 'police_saisie' && (mission as any).saisie_motif_label) {
    motif = String((mission as any).saisie_motif_label).toUpperCase()
  }

  // Detection elargie de la relivraison
  const mtNorm = String(mission.mission_type || '').toUpperCase()
  const isRemRelType = mtNorm.includes('REL')
  const isRedelivery =
    isRemRelType ||
    (mission.source === 'prive') ||
    (mission.source === 'police_snc' && mission.snc_scenario === 'rem_depot') ||
    (mission.source === 'sia_couvert')
  const redeliveryAddr = isRedelivery
    ? (mission.redelivery_address || mission.destination_address || null)
    : null
  if (isRedelivery) motif = 'RELIVRAISON'

  const isAvp = mission.source === 'police_avp'

  // Notes specifiques par source (s applique sauf si relivraison)
  let noteOverride: string | undefined = undefined
  if (!isRedelivery) {
    if (mission.source === 'police_mg') {
      noteOverride = (mission as any).police_blocked ? 'Blocage par police' : 'Pas de blocage'
    } else if (mission.source === 'police_rodeo') {
      const baseDate = new Date(mission.intervention_date || mission.received_at)
      baseDate.setDate(baseDate.getDate() + 3)
      const pad = (n: number) => String(n).padStart(2, '0')
      const j3Str = `${pad(baseDate.getDate())}/${pad(baseDate.getMonth()+1)}/${String(baseDate.getFullYear()).slice(-2)}`
      noteOverride = `Restitution a partir du ${j3Str} avec LEVEE DE SAISIE uniquement`
    } else if (mission.source === 'police_accident') {
      noteOverride = ''
    } else if (mission.source === 'police_saisie') {
      const zone = (mission as any).police_zone || ''
      const officer = (mission as any).officer_name || ''
      const parts = [zone, officer].filter(s => s && String(s).trim()).join(' - ')
      noteOverride = parts || ''
    }
  }

  // Olivier 2026-06-07 : pour les missions destinees a relivraison
  // (REL/REM+REL, prive en parc, SNC/SC rem_depot), on imprime l etiquette
  // REL AU LIEU DE la parc-entree. Le QR pointe vers la meme mission, donc
  // le chauffeur peut la scanner pour s attribuer la mission de relivraison.
  if (isRedelivery) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      const qrTarget = `/qr/mission/${mission.mission_number ?? mission.id}`
      const cleanAddr = (redeliveryAddr || '').trim()
      const addressText = cleanAddr
        ? cleanAddr
        : 'En attente d info adresse de relivraison'
      const assistance = String(
        (mission as any).billed_to_name
        || (mission as any).client_name
        || '—'
      ).toUpperCase()
      const brandModel = [mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')
      const relZpl = buildRelLabelZPL({
        qrUrl:       `${baseUrl}${qrTarget}`,
        plate:       (mission.vehicle_plate || '').trim().toUpperCase() || '—',
        brand_model: brandModel,
        assistance,
        address:     addressText,
      })
      const relResult = await printZPLRaw(relZpl)
      if (!relResult.ok) {
        return { ok: false, error: `Impression REL echec : ${relResult.error}`, mission_id: mission.id }
      }
      return { ok: true, mission_id: mission.id }
    } catch (e: any) {
      return { ok: false, error: `Exception impression REL : ${e?.message || e}`, mission_id: mission.id }
    }
  }

  // Veh normal en parc : etiquette parc-entree classique
  const result = await printVdSoftParcLabel({
    missionId:        mission.id,
    missionNumber:    mission.mission_number ?? null,
    odooTicketId:     mission.odoo_ticket_id ?? null,
    source:           mission.source,
    motif,
    interventionDate: mission.intervention_date || mission.received_at,
    plate:            mission.vehicle_plate,
    brand:            mission.vehicle_brand,
    model:            mission.vehicle_model,
    vin:              mission.vehicle_vin,
    redeliveryAddr,
    isAvp,
    noteOverride,
    noteAppend: opts?.noteAppend,
  })

  if (!result.ok) return { ok: false, error: result.error || 'Impression echec', mission_id: mission.id }
  return { ok: true, mission_id: mission.id }
}
