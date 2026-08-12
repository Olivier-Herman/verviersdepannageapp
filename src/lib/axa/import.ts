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
import { sendNotification, sendNotificationToRoles } from '@/lib/notifications/send'
import { getMissions, filterActionable, getMission } from './goassist'

// Statuts VD Soft où le chauffeur EST PARTI (en route / sur place / livraison) :
// une annulation AXA à ce stade = trajet à vide à facturer (déplacement compté).
// En deçà (new/dispatching/assigned/accepted) = pas encore parti → annulation simple.
// Même règle que Kaze/Allianz (Olivier 2026-08-11).
const AXA_STARTED_STATUSES = ['in_progress', 'delivering']
// États terminaux : on ne touche pas.
const AXA_TERMINAL_STATUSES = ['completed', 'to_invoice', 'invoiced', 'cancelled', 'ignored', 'parked']

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
  // AXA peut déjà exister dans VD Soft via une autre source (ex. mail). On ne le
  // recrée pas ; on ne propose à la création que les dossiers ABSENTS.
  // ⚠️ La réf VD Soft peut CONTENIR le n° AXA sans y être égale : un accident
  // repris par AXA a une réf combinée « ACC-4347 / 0126551053-REL ». → match
  // « CONTIENT le numéro » (ilike), pas égalité stricte. (Olivier 2026-08-13)
  const caseIds = Array.from(new Set<string>(awaiting.map(m => m.case?.caseId).filter(Boolean)))
  const existingCaseIds = new Set<string>() // caseIds déjà présents dans VD Soft
  if (caseIds.length) {
    const orFilter = caseIds.map(c => `dossier_number.ilike.*${c}*`).join(',')
    const { data } = await sb
      .from('incoming_missions')
      .select('dossier_number')
      .or(orFilter)
      .not('status', 'in', '(cancelled,ignored)')
    const found = (data || []).map(r => String(r.dossier_number || ''))
    for (const c of caseIds) if (found.some(dn => dn.includes(c))) existingCaseIds.add(c)
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
      exists:         !!caseObj.caseId && existingCaseIds.has(caseObj.caseId),
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
        // go&assist New = à valider → 'new' ; AwaitingDispatch = déjà validée par
        // AXA → 'dispatching' (validée, en attente d'assignation), pas de Valider.
        status:            item.axaStatus === 'New' ? 'new' : 'dispatching',
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
      const { data: created, error } = await sb.from('incoming_missions').insert(row).select('id').single()
      if (error) { errors.push(`${m.missionOrderId}: ${error.message}`); continue }
      imported++

      // Notif dispatch UNIQUEMENT pour les `New` (fenêtre d'acceptation courte —
      // il faut valider vite). Les `AwaitingDispatch` sont déjà validées → pas d'urgence.
      if (item.axaStatus === 'New' && created?.id) {
        await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'axa_new_to_validate', {
          title:      '🅰️ Mission AXA à valider',
          body:       `${row.vehicle_plate || item.plate || '—'} · ${row.incident_city || '—'} — fenêtre courte, valider vite`,
          action_url: `/dispatch/${created.id}`,
          mission_id: created.id,
        }).catch(() => {})
      }
    } catch (e: any) {
      errors.push(`${m.missionOrderId}: ${e?.message || 'exception'}`)
    }
  }

  // Réconciliation des annulations (règle Allianz/Kaze) — même en preview on
  // NE touche RIEN si mode !== 'send'.
  if (mode === 'send') {
    try { await reconcileAxaCancellations(sb, all) }
    catch (e: any) { errors.push(`reconcile: ${e?.message || 'exception'}`) }
  }

  const news = awaiting.filter(m => m.status === 'New').length
  return { ok: errors.length === 0, mode, awaiting: awaiting.length, news, items, imported, skipped, errors }
}

/**
 * Annulations AXA (règle Allianz/Kaze) : pour chaque fiche AXA ouverte chez nous
 * dont la mission go&assist est passée à `Cancelled`/`Refused` :
 *   - chauffeur PAS parti (new/dispatching/assigned/accepted) → annulation simple ;
 *   - chauffeur PARTI (in_progress/delivering) → trajet à vide (fiche GARDÉE +
 *     lien go&assist conservé pour clôture avec pointages en MovementForNothing).
 */
async function reconcileAxaCancellations(sb: ReturnType<typeof createAdminClient>, missions: any[]): Promise<void> {
  // Statut go&assist courant par missionOrderId.
  const gaStatus = new Map<string, string>()
  for (const m of missions) if (m.missionOrderId) gaStatus.set(m.missionOrderId, m.status)

  // Fiches AXA ouvertes chez nous (non terminales).
  const { data: openFiches } = await sb
    .from('incoming_missions')
    .select('id, external_id, status, assigned_to, mission_type, mission_number')
    .eq('source', 'axa')
    .not('status', 'in', `(${AXA_TERMINAL_STATUSES.join(',')})`)
  if (!openFiches?.length) return

  for (const f of openFiches) {
    if (!f.external_id) continue
    const gs = gaStatus.get(f.external_id)
    if (gs !== 'Cancelled' && gs !== 'Refused') continue // annulée seulement si go&assist l'a annulée/refusée

    const num = f.mission_number ? `#${f.mission_number}` : ''

    if (AXA_STARTED_STATUSES.includes(f.status)) {
      // ── Chauffeur parti → trajet à vide (fiche gardée, lien conservé) ────────
      await sb.from('incoming_missions')
        .update({ mission_type: 'trajet_vide', updated_at: new Date().toISOString() })
        .eq('id', f.id)
      await sb.from('mission_logs').insert({
        mission_id: f.id, action: 'cancelled_by_axa_after_start',
        notes: `Annulée par AXA (go&assist : ${gs}) après départ chauffeur → trajet à vide à facturer.`,
        metadata: { mission_order_id: f.external_id, previous_status: f.status, original_mission_type: f.mission_type, ga_status: gs },
      }).then(() => {}, () => {})
      const payload = {
        title: 'Mission AXA annulée', body: `La mission ${num} a été annulée par AXA après ton départ. Trajet à vide à facturer.`,
        mission_id: f.id, action_url: `/dispatch/${f.id}`,
      }
      if (f.assigned_to) await sendNotification(f.assigned_to, 'axa_cancelled_after_start', {
        ...payload, body: `La mission ${num} vient d'être annulée par AXA. Fais demi-tour — trajet à vide.`,
      }).catch(() => {})
      await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'axa_cancelled_after_start', payload).catch(() => {})
    } else {
      // ── Pas encore parti → annulation simple ────────────────────────────────
      await sb.from('incoming_missions')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', f.id)
      await sb.from('mission_logs').insert({
        mission_id: f.id, action: 'cancelled_by_axa',
        notes: `Annulée par AXA (go&assist : ${gs}) avant départ chauffeur.`,
        metadata: { mission_order_id: f.external_id, previous_status: f.status, ga_status: gs },
      }).then(() => {}, () => {})
    }
  }
}
