// src/lib/towsoft/import-for-billing.ts
//
// Olivier 2026-06-12 : importe une fiche TowSoft dans VD Soft pour la facturer.
// Cree une incoming_missions en statut 'to_invoice' a partir du detail TowSoft
// (5 endpoints) afin que la modale de facturation habituelle prenne le relais.
//
// Dedup : UNIQUEMENT par external_id = TS-<num> (la cle unique de la fiche
// TowSoft). On ne dedup PAS par plaque/VIN seuls — ce serait dangereux ici
// (le meme vehicule a souvent plusieurs missions distinctes ; on melangerait
// deux dossiers a facturer).

import { createAdminClient }   from '@/lib/supabase'
import { fetchTowsoftDetail }  from '@/lib/towsoft-detail'
import { parseTowsoftDateUTC, searchTowsoftGlobal } from '@/lib/towsoft-client'

export interface ImportForBillingResult {
  ok:          boolean
  mission_id?: string
  action?:     'created' | 'existing'
  towsoft_num: string
  error?:      string
}

/** Mapping motif/nature TowSoft -> source/type VD Soft (aligne migration-worker). */
function inferSourceAndType(motif: string | null): { source: string; mission_type: string } {
  if (!motif) return { source: 'legacy_towsoft_migration', mission_type: 'remorquage' }
  const m = motif.toLowerCase().trim()
  if (m.includes('mal') && m.includes('gar'))     return { source: 'police_mg',        mission_type: 'remorquage' }
  if (m.includes('accident'))                      return { source: 'police_accident',  mission_type: 'remorquage' }
  if (m.includes('saisie'))                        return { source: 'police_saisie',    mission_type: 'remorquage' }
  if (m.includes('rodeo') || m.includes('rodéo'))  return { source: 'police_rodeo',     mission_type: 'remorquage' }
  if (m.includes('avp') || m.includes('abandon'))  return { source: 'police_avp',       mission_type: 'remorquage' }
  if (m.includes('siabis non couvert'))            return { source: 'police_snc',       mission_type: 'remorquage' }
  if (m.includes('siabis couvert'))                return { source: 'sia_couvert',      mission_type: 'remorquage' }
  if (m.includes('privé') || m.includes('prive'))  return { source: 'prive',            mission_type: 'remorquage' }
  if (m.includes('dépann') || m.includes('depann')) return { source: 'legacy_towsoft_migration', mission_type: 'depannage' }
  return { source: 'legacy_towsoft_migration', mission_type: 'remorquage' }
}

function parseMontant(raw: string | null): number | null {
  if (!raw) return null
  const cleaned = String(raw).replace(/[^\d.,]/g, '').trim()
  if (!cleaned) return null
  const norm = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}

export async function importTowsoftForBilling(towsoftNum: string | number): Promise<ImportForBillingResult> {
  const num = String(towsoftNum).trim()
  if (!num) return { ok: false, towsoft_num: num, error: 'Numero requis' }

  const sb = createAdminClient()
  const externalId = `TS-${num}`

  // 1. Dedup : la fiche TowSoft est-elle deja dans VD Soft ?
  const { data: existing } = await sb
    .from('incoming_missions')
    .select('id')
    .eq('external_id', externalId)
    .maybeSingle()
  if (existing) {
    return { ok: true, mission_id: existing.id, action: 'existing', towsoft_num: num }
  }

  // 2. Detail complet TowSoft (adresses, proprio, police) — best-effort
  let detail
  try {
    detail = await fetchTowsoftDetail(num)
  } catch (e: any) {
    return { ok: false, towsoft_num: num, error: `Détail TowSoft KO : ${e.message}` }
  }

  // 2bis. Recherche live : le parsing vehicule/montant/type/dossier y est plus
  // fiable que le detail (ex: marque mal lue "Oui" cote detail). On la prend
  // en priorite pour ces champs.
  let row: any = null
  try {
    const rows = await searchTowsoftGlobal('id_appel', num)
    row = rows.find(r => r.towsoft_num === num) || rows[0] || null
  } catch { /* non bloquant : on retombe sur detail */ }

  const plate  = row?.plate  || detail.immatriculation || null
  const vin    = row?.vin    || detail.vin || null
  const brand  = row?.brand  || detail.marque || null
  const model  = row?.model  || detail.modele || null
  // billed_to_name = qui paye (assistance/compagnie), depuis la colonne client
  // de la recherche (ex "ETHIAS ASSISTANCE (299429K)") ou le client du detail.
  const payer  = row?.client || detail.client_name || null

  const { source, mission_type } = inferSourceAndType(row?.type || detail.nature || detail.motif_parc || detail.appel_status)
  const dateIso = row?.date_iso || parseTowsoftDateUTC(detail.date_appel) || new Date().toISOString()
  const montantTtc = row?.montant_ttc != null ? row.montant_ttc : parseMontant(detail.total_ttc)

  const insertPayload: Record<string, any> = {
    external_id:        externalId,
    source,
    mission_type,
    status:             'to_invoice',

    vehicle_plate:      plate,
    vehicle_brand:      brand,
    vehicle_model:      model,
    vehicle_vin:        vin,

    client_name:        detail.client_name || payer || null,
    billed_to_name:     payer || null,
    incident_address:   detail.origine_addr || row?.lieu_intervention || null,
    incident_city:      detail.origine_ville || null,
    incident_lat:       detail.origine_lat ? parseFloat(detail.origine_lat) : null,
    incident_lng:       detail.origine_lng ? parseFloat(detail.origine_lng) : null,

    destination_address: detail.dest_addr || row?.destination || null,
    destination_lat:    detail.dest_lat ? parseFloat(detail.dest_lat) : null,
    destination_lng:    detail.dest_lng ? parseFloat(detail.dest_lng) : null,

    dossier_number:     detail.dossier_police || detail.po || row?.dossier || null,
    officer_name:       detail.nom_responsable || null,
    police_pv_number:   detail.numero_pv || null,
    keys_digibox_slot:  detail.cle_box || null,

    remarks_general:    detail.remarque || row?.remarks || null,
    invoice_number:     detail.facture_no || row?.num_facture || null,

    // Montant TVAC connu cote TowSoft (indicatif : la modale recalcule/edite)
    amount_to_collect:  montantTtc,

    received_at:        dateIso,
    intervention_date:  dateIso,
    completed_at:       dateIso,

    towsoft_enriched_at: new Date().toISOString(),
    created_at:         new Date().toISOString(),
    updated_at:         new Date().toISOString(),
  }

  const { data: created, error: insErr } = await sb
    .from('incoming_missions')
    .insert(insertPayload)
    .select('id')
    .single()

  if (insErr || !created) {
    return { ok: false, towsoft_num: num, error: `INSERT KO : ${insErr?.message || 'unknown'}` }
  }

  return { ok: true, mission_id: created.id, action: 'created', towsoft_num: num }
}
