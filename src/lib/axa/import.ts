// src/lib/axa/import.ts
//
// Intake AXA go&assist par POLL API (modèle VAB/Kaze — PAS déclenché au mail :
// plus précis, cf mémoire). Récupère les missions « à affecter » (AwaitingDispatch)
// et crée une fiche `incoming_missions` en statut `new`. Partagé par le cron
// (/api/cron/axa-poll) et le bouton manuel (/api/axa/import). Olivier 2026-08-11.
//
// Cf [[project_axa_goassist_integration]]. On NE touche PAS go&assist ici (lecture
// seule) : l'acceptation (accept) et l'affectation (dispatch) sont déclenchées
// ailleurs (validation fiche / assignation chauffeur).

import { createAdminClient } from '@/lib/supabase'
import { getMissions, filterAwaitingDispatch, getMission } from './goassist'

export type ImportMode = 'preview' | 'send'

export interface AxaImportItem {
  missionOrderId: string
  caseId:         string
  plate:          string
  serviceCode:    string
  mission_type:   string
  client_name:    string
  incident_city:  string
  exists:         boolean
}

export interface AxaImportResult {
  ok:        boolean
  mode:      ImportMode
  awaiting:  number
  items:     AxaImportItem[]
  imported:  number
  skipped:   number
  errors:    string[]
}

function mapServiceToType(serviceCode: string): string {
  const c = (serviceCode || '').toUpperCase()
  if (c.includes('TOW')) return 'remorquage'
  return 'depannage' // REPAIR_ON_SPOT et autres interventions sur place
}

/**
 * Poll + création de fiches. `preview` = ne fait qu'inventorier ; `send` = insère
 * les nouvelles fiches (dédup par external_id = missionOrderId, non annulées).
 */
export async function runAxaImport({ mode = 'preview' }: { mode?: ImportMode } = {}): Promise<AxaImportResult> {
  const sb = createAdminClient()
  const errors: string[] = []

  const all = await getMissions()
  const awaiting = filterAwaitingDispatch(all)

  // fiches AXA déjà présentes (dédup) — par external_id (missionOrderId)
  const orderIds = awaiting.map(m => m.missionOrderId).filter(Boolean)
  const existing = new Set<string>()
  if (orderIds.length) {
    const { data } = await sb
      .from('incoming_missions')
      .select('external_id')
      .eq('source', 'axa')
      .in('external_id', orderIds)
      .not('status', 'in', '(cancelled,ignored)')
    for (const r of data || []) if (r.external_id) existing.add(r.external_id)
  }

  const items: AxaImportItem[] = []
  let imported = 0, skipped = 0

  for (const m of awaiting) {
    const caseObj = m.case || {}
    const service = caseObj.service || {}
    const contact = (m.contacts || []).find((c: any) => c?.firstName || c?.lastName) || (m.contacts || [])[0] || {}
    const item: AxaImportItem = {
      missionOrderId: m.missionOrderId,
      caseId:         caseObj.caseId || '',
      plate:          caseObj.registrationPlateNumber || '',
      serviceCode:    service.serviceCode || '',
      mission_type:   mapServiceToType(service.serviceCode),
      client_name:    [contact.firstName, contact.lastName].filter(Boolean).join(' '),
      incident_city:  caseObj.incidentLocation?.address?.locality || '',
      exists:         existing.has(m.missionOrderId),
    }
    items.push(item)

    if (mode !== 'send' || item.exists) { if (item.exists) skipped++; continue }

    try {
      // Enrichir avec le détail (véhicule/VIN/adresse/coords/destination).
      const d = await getMission(m.missionOrderId)
      const dc = d?.case || caseObj
      const addr = dc.incidentLocation?.address || {}
      const dest = dc.service?.serviceDestination || null
      const veh = d?.vehicle || dc.vehicle || {}
      const ct = (d?.contacts || m.contacts || []).find((c: any) => c?.firstName || c?.lastName) || {}

      const row: Record<string, any> = {
        source:            'axa',
        source_format:     'axa-goassist',
        status:            'new',
        external_id:       m.missionOrderId,
        dossier_number:    dc.caseId || item.caseId || null,
        mission_type:      item.mission_type,
        vehicle_plate:     dc.registrationPlateNumber || item.plate || null,
        vehicle_brand:     veh.brand || null,
        vehicle_model:     veh.model || null,
        vehicle_vin:       veh.referenceNumber || null,
        client_name:       [ct.firstName, ct.lastName].filter(Boolean).join(' ') || null,
        client_phone:      ct.phoneNumber || null,
        incident_address:  addr.streetAddress || null,
        incident_city:     addr.locality || null,
        destination_name:  dest?.name || (dest?.category ? 'Garage partenaire' : null),
        destination_address: dest?.address?.streetAddress || null,
        received_at:       m.missionSendingDate || new Date().toISOString(),
        intervention_date: service.maximumDelayOfArrivalDate || null,
        billed_to_name:    'AXA',
      }
      const { error } = await sb.from('incoming_missions').insert(row)
      if (error) { errors.push(`${m.missionOrderId}: ${error.message}`); continue }
      imported++
    } catch (e: any) {
      errors.push(`${m.missionOrderId}: ${e?.message || 'exception'}`)
    }
  }

  return { ok: errors.length === 0, mode, awaiting: awaiting.length, items, imported, skipped, errors }
}
