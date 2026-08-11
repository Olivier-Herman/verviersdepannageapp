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
import { getMissions, filterActionable, getMission } from './goassist'

export type ImportMode = 'preview' | 'send'

export interface AxaImportItem {
  missionOrderId: string
  caseId:         string
  plate:          string
  serviceCode:    string
  mission_type:   string
  client_name:    string
  incident_city:  string
  axaStatus:      string   // 'New' (à valider) | 'AwaitingDispatch' (déjà validé)
  exists:         boolean
}

export interface AxaImportResult {
  ok:        boolean
  mode:      ImportMode
  awaiting:  number   // total actionnable (New + AwaitingDispatch)
  news:      number   // dont status New (à valider)
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
  const awaiting = filterActionable(all)

  // Dédup par NUMÉRO DE DOSSIER (caseId), TOUTES sources confondues : un dossier
  // AXA peut déjà exister dans VD Soft via une autre source (ex. mail) → on ne le
  // recrée pas. On ne proposera à la création que les dossiers ABSENTS.
  // (Chez AXA : 1 dossier = 1 mission dans go&assist, pas de multi-fiche.)
  const caseIds = Array.from(new Set(awaiting.map(m => m.case?.caseId).filter(Boolean)))
  const existingDossiers = new Set<string>()
  if (caseIds.length) {
    const { data } = await sb
      .from('incoming_missions')
      .select('dossier_number')
      .in('dossier_number', caseIds)
      .not('status', 'in', '(cancelled,ignored)')
    for (const r of data || []) if (r.dossier_number) existingDossiers.add(r.dossier_number)
  }

  const items: AxaImportItem[] = []
  const insertedDossiers = new Set<string>() // garde générique anti-doublon intra-run (même caseId renvoyé 2× par l'API)
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
      axaStatus:      m.status,
      exists:         !!caseObj.caseId && existingDossiers.has(caseObj.caseId),
    }
    items.push(item)

    if (mode !== 'send' || item.exists) { if (item.exists) skipped++; continue }
    if (caseObj.caseId && insertedDossiers.has(caseObj.caseId)) { skipped++; continue }
    if (caseObj.caseId) insertedDossiers.add(caseObj.caseId)

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

  const news = awaiting.filter(m => m.status === 'New').length
  return { ok: errors.length === 0, mode, awaiting: awaiting.length, news, items, imported, skipped, errors }
}
