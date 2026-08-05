// src/lib/touring/check-list.ts
//
// Construit la file « Check Touring » : les dossiers Touring HORS COMEX qui doivent
// être tranchés par Touring avant qu'on puisse les facturer.
//
// Exclusions (demandées par Olivier) :
//   1. Dossier clôturé il y a moins de 15 jours (combiné → date de la DERNIÈRE
//      clôture chauffeur sur toute la chaîne : max(completed_at)).
//   2. Dossier encore dans COMEX BKO (touring_comex_dossiers.in_comex = true) —
//      couvre les comptes VERVIERS + D68357 côté facturation.
//   3. Dossier encore ouvert dans le /Comex OPÉRATIONNEL de d68267
//      (listComexMissions, COD_STATUT_MTR != '07').

import { loginComex, listComexMissions } from './comex'

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000

const COLS =
  'id, parent_mission_id, status, source, dossier_number, external_id, ' +
  'mission_type, incident_type, vehicle_plate, vehicle_brand, vehicle_model, ' +
  'incident_address, incident_city, destination_name, destination_address, ' +
  'redelivery_address, intervention_date, completed_at, parked_at, touring_check_stamp, ' +
  'billed_to_id, billed_to_name'

// Partenaire Odoo « Touring » (facturé à Touring).
const TOURING_BILLED_ID = 14

/**
 * Une mission entre dans la file Check Touring si :
 *   - sa source est 'touring' (dossiers Touring natifs / importés), OU
 *   - c'est un appel POLICE ou un SIABIS COUVERT facturé à Touring.
 * (Chez Touring, seul COMEX BKO s'auto-facture ; ces dossiers hors comex doivent
 *  donc être tranchés par Touring.)
 */
function isTouringForCheck(m: any): boolean {
  if (m.source === 'touring') return true
  const billedTouring = m.billed_to_id === TOURING_BILLED_ID || /touring/i.test(m.billed_to_name || '')
  const src = String(m.source || '')
  return (src.startsWith('police') || src === 'sia_couvert') && billedTouring
}

/** Libellé du montant dépannage à afficher selon la source (null = pas d'affichage). */
function depannageLabel(source: string | null): string | null {
  const s = String(source || '')
  if (s === 'police_snc')  return 'Siabis non couvert'  // SNC repris par Touring (reste un SNC)
  if (s === 'sia_couvert')  return 'Siabis couvert'
  if (s.startsWith('police')) return 'Appel police'
  return null
}

export type FicheKind = 'REM' | 'DSP' | 'REL' | 'DPR' | 'AUTRE'

export function ficheKind(m: any): FicheKind {
  const mt = m.mission_type
  const it = m.incident_type
  if (mt === 'relivraison' || mt === 'rel' || it === 'relivraison' || m.parent_mission_id) return 'REL'
  if (it === 'dpr') return 'DPR'
  if (mt === 'remorquage') return 'REM'
  if (['depannage', 'reparation_place', 'trajet_vide'].includes(mt)) return 'DSP'
  return 'AUTRE'
}

export interface CheckFiche {
  mission_id: string
  kind: FicheKind
  mission_type: string | null
  dossier_number: string | null
  external_id: string | null
  plate: string | null
  brand: string | null
  model: string | null
  incident: string | null      // lieu d'intervention (adresse + ville)
  destination: string | null   // lieu de livraison (remorquage / relivraison)
  intervention_date: string | null
  depannage_label: string | null       // 'Appel police' | 'Siabis couvert' | null
  depannage_htva: number | null        // sous-total DÉPANNAGE HT (hors gardiennage)
}

const APP_BASE = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'

/**
 * Sous-total DÉPANNAGE HT d'une fiche (dépannage + majoration, HORS gardiennage).
 * On somme les lignes facturables du breakdown en excluant le gardiennage/parc —
 * plus fiable que `subtotal_eur − parc_eur` (parc_eur peut valoir 0 alors que le
 * gardiennage est déjà dans subtotal_eur, et subtotal_eur n'inclut pas la majoration).
 */
async function policeDepannageHtva(missionId: string): Promise<number | null> {
  try {
    const r = await fetch(`${APP_BASE}/api/missions/${missionId}/price-estimate`, {
      headers: { 'x-internal-secret': process.env.NEXTAUTH_SECRET || '' },
    })
    const j = await r.json().catch(() => ({}))
    if (!j?.ok) return null
    if (Array.isArray(j.breakdown) && j.breakdown.length) {
      let sum = 0
      for (const b of j.breakdown) {
        if (b?.amount == null) continue
        const lbl = String(b.label || '').toLowerCase()
        if (lbl.includes('gardiennage') || lbl.includes('parc')) continue  // exclut le gardiennage
        const n = Number(b.amount)
        if (Number.isFinite(n)) sum += n
      }
      const dep = Math.round(sum * 100) / 100
      return dep > 0 ? dep : null
    }
    // Repli (modes sans breakdown détaillé).
    const dep = Math.round((Number(j.subtotal_eur || 0) - Number(j.parc_eur || 0)) * 100) / 100
    return dep > 0 ? dep : null
  } catch { return null }
}

export interface CheckItem {
  root_mission_id: string
  dossier_number: string | null
  intervention_date: string | null
  is_combined: boolean
  fiches: CheckFiche[]
}

/** Ensemble des mission_ids couverts par COMEX BKO (in_comex=true). */
async function comexBkoMissionIds(sb: any): Promise<Set<string>> {
  const ids = new Set<string>()
  const { data } = await sb
    .from('touring_comex_dossiers')
    .select('mission_id, mission_ids')
    .eq('in_comex', true)
  for (const d of data || []) {
    if (d.mission_id) ids.add(d.mission_id)
    for (const mid of (Array.isArray(d.mission_ids) ? d.mission_ids : [])) ids.add(mid)
  }
  return ids
}

/** Dossiers encore OUVERTS dans le /Comex opérationnel d68267 (best effort). */
async function comexOpenDossiers(): Promise<Set<string> | null> {
  try {
    const session = await loginComex('dispatch')
    const missions = await listComexMissions(session)
    const open = new Set<string>()
    for (const m of missions) {
      if (String(m.COD_STATUT_MTR) !== '07') {
        const dos = String(m.CID_DOS || '').toUpperCase()
        if (dos) open.add(dos)
      }
    }
    return open
  } catch (e: any) {
    // COMEX indisponible → on n'exclut pas sur ce critère (le superadmin revoit la liste).
    console.error('[check-list] comexOpenDossiers échec (non bloquant):', e?.message)
    return null
  }
}

function addr(a?: string | null, city?: string | null): string | null {
  const s = [a, city].filter(Boolean).join(', ').trim()
  return s || null
}

/**
 * Construit la liste des dossiers hors-comex à faire trancher.
 * @param sb client Supabase admin (service_role)
 */
export async function buildTouringCheckList(sb: any): Promise<CheckItem[]> {
  // 1. Missions Touring en attente de facturation.
  const { data: queue, error } = await sb
    .from('incoming_missions')
    .select(COLS)
    .eq('status', 'to_invoice')
    .or(`source.eq.touring,billed_to_id.eq.${TOURING_BILLED_ID}`)
  if (error) throw new Error(error.message)
  if (!queue?.length) return []

  // Racines des chaînes concernées.
  const roots = new Set<string>()
  for (const m of queue) roots.add(m.parent_mission_id || m.id)
  const rootArr = [...roots]

  // 2. Toutes les fiches des chaînes (parent + enfants) pour max(completed_at) + affichage.
  const { data: chainRows } = await sb
    .from('incoming_missions')
    .select(COLS)
    .or(`id.in.(${rootArr.join(',')}),parent_mission_id.in.(${rootArr.join(',')})`)
  const chain: any[] = chainRows || []
  const byRoot = new Map<string, any[]>()
  for (const m of chain) {
    const r = m.parent_mission_id || m.id
    if (!byRoot.has(r)) byRoot.set(r, [])
    byRoot.get(r)!.push(m)
  }

  // Exclusions transverses.
  const bkoIds = await comexBkoMissionIds(sb)
  const openDossiers = await comexOpenDossiers()
  const now = Date.now()

  const items: CheckItem[] = []
  for (const root of rootArr) {
    const all = byRoot.get(root) || []
    if (!all.length) continue

    // Fiches à trancher = fiches Touring (source touring OU police facturé Touring)
    // en to_invoice, hors COMEX BKO.
    const toBill = all.filter(m =>
      isTouringForCheck(m) && m.status === 'to_invoice' && !bkoIds.has(m.id))
    if (!toBill.length) continue

    // Exclusion 1 — dernière clôture chauffeur < 15 j (sur toute la chaîne).
    const lastClose = all
      .map(m => m.completed_at ? new Date(m.completed_at).getTime() : 0)
      .reduce((a, b) => Math.max(a, b), 0)
    if (lastClose && (now - lastClose) < FIFTEEN_DAYS_MS) continue

    // Exclusion 3 — encore ouvert dans /Comex opérationnel d68267.
    if (openDossiers) {
      const dossiers = new Set(all.map(m => String(m.dossier_number || '').toUpperCase()).filter(Boolean))
      let stillOpen = false
      for (const d of dossiers) if (openDossiers.has(d)) { stillOpen = true; break }
      if (stillOpen) continue
    }

    // Ordre : parent d'abord, puis enfants.
    const rootFiche = all.find(m => m.id === root)
    const fiches: CheckFiche[] = toBill
      .sort((a, b) => (a.id === root ? -1 : b.id === root ? 1 : 0))
      .map(m => ({
        mission_id: m.id,
        kind: ficheKind(m),
        mission_type: m.mission_type,
        dossier_number: m.dossier_number,
        external_id: m.external_id,
        plate: m.vehicle_plate,
        brand: m.vehicle_brand,
        model: m.vehicle_model,
        incident: addr(m.incident_address, m.incident_city),
        destination: m.redelivery_address || m.destination_address || m.destination_name || null,
        intervention_date: m.intervention_date,
        depannage_label: depannageLabel(m.source),
        depannage_htva: null,
      }))

    items.push({
      root_mission_id: root,
      dossier_number: (rootFiche || toBill[0]).dossier_number || (rootFiche || toBill[0]).external_id || null,
      intervention_date: (rootFiche || toBill[0]).intervention_date || null,
      is_combined: all.length > 1,
      fiches,
    })
  }

  // Montant DÉPANNAGE HT (hors gardiennage) des fiches police / siabis couvert.
  const amountFiches = items.flatMap(it => it.fiches).filter(f => f.depannage_label)
  await Promise.all(amountFiches.map(async f => { f.depannage_htva = await policeDepannageHtva(f.mission_id) }))

  // Tri par date d'intervention décroissante (plus récent en haut).
  items.sort((a, b) => (b.intervention_date || '').localeCompare(a.intervention_date || ''))
  return items
}
