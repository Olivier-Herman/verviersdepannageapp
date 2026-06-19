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
  const inc = a?.breakdownAddress || {}
  const dst = a?.repairShopAddress || {}
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
      vehicle_plate:       a?.customerLicensePlate || null,
      vehicle_brand:       a?.customerVehicleBrand || null,
      vehicle_model:       a?.customerVehicleModel || null,
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
