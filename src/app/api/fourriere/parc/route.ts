// src/app/api/fourriere/parc/route.ts
//
// GET /api/fourriere/parc — l'écran « Parc » (refonte Fourrière, temps 1,
// 16/09/2026, artefact 3A6toUwGRKP7EgEtKGLKJF). Une ligne par véhicule au parc
// avec TOUT ce qu'il faut pour lire son état sans ouvrir la fiche : source,
// zone, nuits, réquisitoire, policier, levée, Domaine, AVP à 60 j, abandon,
// destruction, dossier Parquet, gardiennage estimé. La lecture (frise, qui a la
// main, prochaine action) se fait côté client (ParcClient.readVehicle).
// Accès : admin / superadmin / module fourriere.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { listParcZones }     from '@/lib/parc/zones'
import { nightsBetween }     from '@/lib/parc/nights'
import { isRequisitoireDoc } from '@/lib/requisitoire/doc'

export const dynamic     = 'force-dynamic'
export const maxDuration = 20

// « EN PARC » = mêmes statuts que la recherche fourrière et la relance réquisitoire.
const PARC_STATUSES = ['parked', 'delivering', 'unlocated', 'awaiting_payment']
const SELECT = `
  id, mission_number, external_id, dossier_number, source, status, mission_type,
  vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, vehicle_class,
  parc_zone_key, parc_row_number, parc_slot_index, parked_at, received_at, intervention_date, updated_at,
  client_name, client_phone, officer_name, officer_partner_id, police_zone, police_pv_number,
  saisie_motif_code, saisie_motif_label,
  requisitoire_at, requisitoire_doc_path, requisitoire_last_reminder_at, requisitoire_reminder_count, requisitoire_stop,
  levee_saisie_date, levee_saisie_type, levee_saisie_payer,
  domaine_remise_date, domaine_enlevement_date,
  avp_confirm_asked_at, avp_confirm_count, abandon_at, no_charge_at, storage_waived,
  redelivery_address, key_location, odoo_vehicle_id
`

// Régime de gardiennage par source (miroir de la Vue dossier — tarif journalier).
function regimeOf(source: string | null): 'saisie' | 'siabis' | 'assistance' | 'autre' {
  const s = String(source || '').toLowerCase()
  if (s === 'police_saisie') return 'saisie'
  if (s === 'police_snc' || s === 'sia_couvert') return 'siabis'
  if (/^(kaze|vab|touring|tgr_touring|ethias|mondial|allianz|axa|pv_assistance|eurocross|ima)/.test(s)) return 'assistance'
  return 'autre'
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { modules: ['fourriere'] }).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()

  const [{ data: ms, error }, zones, { data: tariffs }, { data: parquet }, { data: destr }, { data: rels }] = await Promise.all([
    sb.from('incoming_missions').select(SELECT).in('status', PARC_STATUSES).eq('dossier_leg', false).order('parked_at', { ascending: true }).limit(3000),
    listParcZones(),
    sb.from('source_tariff_lines').select('mission_type, name, default_price, free_days, effective_to').eq('source', 'gardiennage').eq('kind', 'SERV-PARC'),
    sb.from('saisie_dossiers').select('mission_id, state, billed_to_date, ef_number, paused_at, recipient').neq('state', 'clos'),
    sb.from('destruction_dossiers').select('id, mission_id, dossier_number, epaviste, exited_at').not('mission_id', 'is', null),
    // Relivraisons programmées (enfant REL vivant) → « part le … avec … »
    sb.from('incoming_missions').select('parent_mission_id, status, intervention_date, assigned_to').eq('mission_type', 'relivraison').in('status', ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering']).not('parent_mission_id', 'is', null),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Tarif journalier par régime (voiture ; cyclo si vehicle_class = moto)
  const rate: Record<string, { car: number; moto: number; free: number }> = {}
  for (const t of tariffs || []) {
    if ((t as any).effective_to && new Date((t as any).effective_to).getTime() < Date.now()) continue
    const k = String((t as any).mission_type); const cyclo = /cyclo/i.test(String((t as any).name || ''))
    rate[k] ||= { car: 0, moto: 0, free: 0 }
    if (cyclo) rate[k].moto = Number((t as any).default_price || 0); else { rate[k].car = Number((t as any).default_price || 0); rate[k].free = Number((t as any).free_days || 0) }
  }
  const zoneByKey = new Map(zones.map(z => [z.key.toLowerCase(), z]))
  const parquetBy = new Map((parquet || []).map((p: any) => [p.mission_id, p]))
  const destrBy   = new Map((destr || []).map((d: any) => [d.mission_id, d]))
  const relBy     = new Map((rels || []).map((r: any) => [r.parent_mission_id, r]))
  // Non-localisés : dernier inventaire (table parc_inventory_missing si présente) — best effort.
  let missing = new Set<string>()
  try { const { data } = await sb.from('parc_inventory_missing').select('mission_id'); missing = new Set((data || []).map((x: any) => x.mission_id)) } catch { /* table absente : rien */ }

  const vehicles = (ms || []).map((m: any) => {
    const entry = m.parked_at || m.intervention_date || m.received_at
    const nights = entry ? nightsBetween(entry) : 0
    const regime = regimeOf(m.source)
    const r = rate[regime] || { car: 0, moto: 0, free: 0 }
    const isMoto = String(m.vehicle_class || '').toLowerCase() === 'moto'
    const price = isMoto ? r.moto : r.car
    // Levée « frais de justice » : la période sous saisie part au Parquet ; ce qui court
    // depuis le lendemain de la levée est au tarif « autre », à charge du client.
    let storage = 0, storageNote = ''
    if (m.no_charge_at || m.storage_waived) { storage = 0; storageNote = m.storage_waived ? 'offert' : 'sans frais' }
    else if (regime === 'saisie' && m.levee_saisie_date && m.levee_saisie_type !== 'temporaire') {
      const after = nightsBetween(`${String(m.levee_saisie_date).slice(0, 10)}T23:59:59Z`)
      storage = Math.max(0, after) * (rate.autre?.car || 20); storageNote = `${after} nuit(s) hors saisie × ${rate.autre?.car || 20} €`
    } else { const billable = Math.max(0, nights - (r.free || 0)); storage = billable * price; storageNote = `${billable} nuit(s) × ${price.toFixed(2)} €${r.free ? ` (${r.free} offertes)` : ''}` }
    const zoneConf = m.parc_zone_key ? zoneByKey.get(String(m.parc_zone_key).toLowerCase()) : null
    const pq = parquetBy.get(m.id); const dd = destrBy.get(m.id); const rel = relBy.get(m.id)
    return {
      id: m.id, mission_number: m.mission_number, external_id: m.external_id, dossier_number: m.dossier_number,
      source: m.source, status: m.status, mission_type: m.mission_type,
      plate: m.vehicle_plate, vin: m.vehicle_vin, brand: m.vehicle_brand, model: m.vehicle_model,
      zone: m.parc_zone_key, zone_label: zoneConf?.label || m.parc_zone_key, row: m.parc_row_number, slot: m.parc_slot_index,
      entered_at: entry, nights, regime, storage_htva: Math.round(storage * 100) / 100, storage_note: storageNote,
      client_name: m.client_name, officer_name: m.officer_name, officer_partner_id: m.officer_partner_id, police_zone: m.police_zone, pv: m.police_pv_number,
      motif: m.saisie_motif_label, motif_code: m.saisie_motif_code,
      requisitoire_ok: !!m.requisitoire_at && isRequisitoireDoc(m.requisitoire_doc_path),
      requisitoire_at: m.requisitoire_at, requisitoire_reminders: m.requisitoire_reminder_count || 0, requisitoire_last_reminder_at: m.requisitoire_last_reminder_at, requisitoire_stop: !!m.requisitoire_stop,
      levee_date: m.levee_saisie_date, levee_type: m.levee_saisie_type, levee_payer: m.levee_saisie_payer,
      domaine_remise_date: m.domaine_remise_date, domaine_enlevement_date: m.domaine_enlevement_date,
      avp_asked_at: m.avp_confirm_asked_at, avp_asked_count: m.avp_confirm_count || 0, abandon_at: m.abandon_at,
      parquet: pq ? { state: pq.state, billed_to_date: pq.billed_to_date, ef_number: pq.ef_number, paused: !!pq.paused_at, recipient: pq.recipient } : null,
      destruction: dd ? { id: dd.id, status: `${dd.dossier_number}${dd.epaviste ? ` · ${dd.epaviste}` : ''}` } : null,
      redelivery: rel ? { status: rel.status, at: rel.intervention_date } : null,
      redelivery_address: m.redelivery_address, key_location: m.key_location,
      unlocated: m.status === 'unlocated' || missing.has(m.id),
      odoo_vehicle_id: m.odoo_vehicle_id,
    }
  })
  return NextResponse.json({ ok: true, vehicles, zones: zones.map(z => ({ key: z.key, label: z.label })) })
}
