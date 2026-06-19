// src/lib/allianz/intake.ts
//
// Intake Allianz/Hexalite par API (chantier 2026-06-19, cf mémoire projet).
//
// Principe : le mail Allianz « Nieuwe toewijzing » ne contient qu'un n°
// d'affectation (dans le corps) — aucune donnée exploitable. On va donc
// chercher la donnée AUTORITATIVE sur le portail Hexalite via ce numéro, au
// lieu de parser le corps du mail (vide).
//
// IMPORTANT (Olivier) :
//   - assignmentNumber (le n° du mail) = UNIQUE par affectation = clé de
//     dédup + clôture. Plusieurs affectations peuvent partager un même dossier.
//   - assistanceCaseId = le VRAI dossier (regroupe les affectations).
//
// Cette lib est en LECTURE SEULE (aucune écriture DB, aucun effet de bord côté
// Hexalite). Le mapping est non destructif : c'est l'appelant qui décide
// quoi écrire.

import { getValidAllianzToken } from './closure'
import { createAdminClient }    from '@/lib/supabase'

const BASE_URL = 'https://global.allianzpartners-providerplatform.com'

function headers(token: string): Record<string, string> {
  return {
    'guac-authorization':  `Bearer ${token}`,
    'subscriptioncountry': 'BEL',
    'origin':              'https://www.allianzpartners-providerplatform.com',
    'referer':             'https://www.allianzpartners-providerplatform.com/',
    'accept':              'application/json, text/plain, */*',
    'accept-language':     'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'content-type':        'application/json',
    'User-Agent':          'Mozilla/5.0 (compatible; VerviersDepannage/1.0)',
  }
}

// Onglets Hexalite balayés pour retrouver une affectation par son numéro.
// Une mission fraîche est en TO_ACCEPT/TO_ASSIGN ; on couvre aussi les stades
// suivants au cas où l'enrichissement est relancé plus tard.
const SEARCH_TABS = ['TO_ACCEPT', 'TO_ASSIGN', 'TO_MONITOR', 'TO_COMPLETE', 'TO_CHECK']

/**
 * Récupère l'objet brut d'une affectation Hexalite à partir de son
 * assignmentNumber (= le n° présent dans le mail / notre dossier_number actuel).
 * Balaie les onglets et renvoie la 1re correspondance, sinon null.
 */
export async function fetchAllianzAssignmentByNumber(assignmentNumber: string): Promise<any | null> {
  if (!assignmentNumber) return null
  const token = await getValidAllianzToken()
  const from = '2026-06-01T00:00:00+00:00'
  const to   = new Date(Date.now() + 31 * 24 * 3600_000).toISOString()
  const target = String(assignmentNumber).trim()

  for (const tab of SEARCH_TABS) {
    const url = `${BASE_URL}/hexalite-job-monitoring/v2.0/search/assignments`
      + `?estimatedDispatchTimeFrom=${encodeURIComponent(from)}`
      + `&estimatedDispatchTimeTo=${encodeURIComponent(to)}`
      + `&sort=estimatedDispatchTime,asc&tabType=${tab}&fromCache=true&size=250`
      + `&cache_buster=${Date.now()}`
    try {
      const res = await fetch(url, { headers: headers(token), signal: AbortSignal.timeout(20000) })
      if (!res.ok) continue
      const j = await res.json()
      const content = j?.assignmentJobDataPage?.content || []
      const hit = content.find((a: any) => String(a.assignmentNumber).trim() === target)
      if (hit) return hit
    } catch { /* tab suivant */ }
  }
  return null
}

/**
 * Détail complet d'une affectation (plus riche que la liste : VIN, km, couleur,
 * assistanceCaseNumber, adresses sous jobAssignmentCustomer). Renvoie null si KO.
 */
export async function fetchAllianzAssignmentDetail(assignmentId: string): Promise<any | null> {
  if (!assignmentId) return null
  try {
    const token = await getValidAllianzToken()
    const res = await fetch(`${BASE_URL}/hexalite-job-monitoring/v1.0/assignments/${assignmentId}`, {
      headers: headers(token), signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

function fmtAddress(x: any): string | null {
  if (!x) return null
  const line1 = [x.street, x.streetNumber].filter(Boolean).join(' ')
  const line2 = [x.zipCode, x.city].filter(Boolean).join(' ')
  const parts = [line1, line2, x.countryName].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

export interface AllianzMapped {
  assignment_number:   string
  assistance_case_id:  string | null
  hex_assignment_id:   string | null
  hex_status:          string | null
  fields: {
    vehicle_plate?:        string | null
    vehicle_brand?:        string | null
    vehicle_model?:        string | null
    vehicle_vin?:          string | null
    incident_address?:     string | null
    incident_city?:        string | null
    incident_country?:     string | null
    incident_lat?:         number | null
    incident_lng?:         number | null
    destination_address?:  string | null
    destination_lat?:      number | null
    destination_lng?:      number | null
    remarks_general?:      string | null
    mission_type?:         string | null
  }
}

/**
 * Mappe l'objet API Hexalite vers nos champs fiche.
 * - mission_type = 'transport' si prise en charge OU destination hors Belgique
 *   (règle rapatriement), sinon 'remorquage' si benefitIcon = iconTowing.
 */
export function mapAllianzAssignment(a: any): AllianzMapped {
  // Gère les 2 formes : LISTE (breakdownAddress/customerVehicle* au 1er niveau)
  // et DÉTAIL (jobAssignmentCustomer.breakdownAddress, jobAssignmentVehicle.*).
  const cust = a?.jobAssignmentCustomer || {}
  const veh  = a?.jobAssignmentVehicle  || {}
  const inc = a?.breakdownAddress  || cust.breakdownAddress  || {}
  const dst = a?.repairShopAddress || cust.repairShopAddress || {}
  const incCountry = (inc.countryCode || '').toUpperCase() || null
  const dstCountry = (dst.countryCode || '').toUpperCase() || null
  const horsBelg = (incCountry && incCountry !== 'BE') || (dstCountry && dstCountry !== 'BE')

  let mission_type: string | null = null
  if (horsBelg) mission_type = 'transport'
  else if (a?.benefitIcon === 'iconTowing') mission_type = 'remorquage'

  return {
    assignment_number:  String(a?.assignmentNumber || ''),
    assistance_case_id: a?.assistanceCaseId || null,
    hex_assignment_id:  a?.assignmentId || null,
    hex_status:         a?.currentStatus || null,
    fields: {
      vehicle_plate:       a?.customerLicensePlate || veh.vehicleLicensePlate || null,
      vehicle_brand:       a?.customerVehicleBrand || veh.vehicleBrand || null,
      vehicle_model:       a?.customerVehicleModel || veh.vehicleModel || null,
      vehicle_vin:         veh.vehicleVin || null,
      incident_address:    fmtAddress(inc),
      incident_city:       inc.city || null,
      incident_country:    incCountry,
      incident_lat:        inc.latitude  ?? null,
      incident_lng:        inc.longitude ?? null,
      destination_address: fmtAddress(dst),
      destination_lat:     dst.latitude  ?? null,
      destination_lng:     dst.longitude ?? null,
      remarks_general:     a?.additionalCaseRemarks || null,
      mission_type,
    },
  }
}

/**
 * Filet anti-"mal complétée" : complète une mission Allianz/mondial depuis l'API
 * Hexalite (token persistant, SANS OTP), en NE remplissant QUE les champs vides
 * (jamais d'écrasement). Idéal en fallback quand l'enrichissement OTP/drawer a
 * laissé des trous, ou pour réparer une fiche déjà créée.
 *
 * NB : le nom/téléphone client NE sont PAS récupérés ici (masqués dans l'API de
 * monitoring) — ils viennent du flux OTP/drawer existant.
 *
 * Retourne le nombre de champs remplis. Non bloquant (renvoie ok:false si KO).
 */
export async function completeAllianzMissionFromApi(
  missionId: string,
): Promise<{ ok: boolean; filled: string[]; reason?: string }> {
  const sb = createAdminClient()
  const { data: m } = await sb
    .from('incoming_missions')
    .select('id, source, dossier_number, external_id, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, incident_address, incident_city, incident_country, incident_lat, incident_lng, destination_address, destination_lat, destination_lng, remarks_general, mission_type')
    .eq('id', missionId)
    .maybeSingle()
  if (!m) return { ok: false, filled: [], reason: 'mission introuvable' }

  // Le n° d'affectation Allianz est stocké dans dossier_number (repli external_id).
  // Olivier 2026-06-19 : dossier_number peut être au format "ASSIGNMENT / CASE"
  // (ex. "39261703745447 / 202602698840") → on ne garde que le n° d'affectation
  // (avant le "/"), qui est la clé de recherche Hexalite.
  const assignmentNumber = (m.dossier_number || m.external_id || '').split('/')[0].trim()
  if (!assignmentNumber) return { ok: false, filled: [], reason: 'pas de n° affectation' }

  let listItem: any
  try { listItem = await fetchAllianzAssignmentByNumber(assignmentNumber) }
  catch (e: any) { return { ok: false, filled: [], reason: e?.message || 'fetch KO' } }
  if (!listItem) return { ok: false, filled: [], reason: 'affectation introuvable côté Hexalite' }

  // Détail (plus riche : VIN, km, adresses complètes) ; fallback sur la liste.
  const detail = listItem.assignmentId ? await fetchAllianzAssignmentDetail(listItem.assignmentId) : null
  const mapped = mapAllianzAssignment(detail || listItem)
  const isEmpty = (v: any) => v === null || v === undefined || v === ''

  const update: Record<string, any> = {}
  const filled: string[] = []
  for (const [k, v] of Object.entries(mapped.fields)) {
    if (isEmpty(v)) continue
    if (isEmpty((m as any)[k])) { update[k] = v; filled.push(k) }
  }

  if (filled.length === 0) return { ok: true, filled: [] }

  update.updated_at = new Date().toISOString()
  const { error } = await sb.from('incoming_missions').update(update).eq('id', missionId)
  if (error) return { ok: false, filled: [], reason: error.message }

  await sb.from('mission_logs').insert({
    mission_id: missionId,
    action:     'enriched',
    notes:      `Complétée depuis l'API Hexalite (filet) : ${filled.join(', ')}`,
    metadata:   { source: 'allianz_api_intake', assignment_number: assignmentNumber, filled },
  }).then(() => {}, () => {})

  return { ok: true, filled }
}
