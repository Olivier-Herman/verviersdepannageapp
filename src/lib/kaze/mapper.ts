// src/lib/kaze/mapper.ts
//
// Mapping d un Job Kaze (workflow IMA Benelux) vers les colonnes de
// incoming_missions cote VD Soft.
//
// Le workflow Kaze est un arbre nesté de widgets typés. Chaque widget a un
// `id` (souvent string parlant comme "registrationnumber", "brand", etc.) et
// une `data` au format { value, version }.
//
// Strategie : on parcourt l arbre une fois, on flatten dans une Map<id, value>
// puis on lit les champs qu on connait du template IMA pour Verviers.
//
// Le template IMA observe (job_workflow_id = 7e63b240-e277-42bd-bbf9-7ba89447baee)
// expose ces widgets clefs (ids decouverts via le payload du 2026-05-20) :
//
//   Identification :
//     - meanscode           "Remorquage/Slepen" | "Relivraison/Herlevering" | "Depannage/Pechverhelping"
//     - prediagnostic       Pre-diagnostic IMA
//     - clienteffect        Code Effet Client (description panne)
//     - eventorigin_precision  Detail des faits generateurs
//
//   Vehicule :
//     - brand, model, registrationnumber, type, energy
//     - firstregistrationdat, mileage
//
//   Beneficiaire :
//     - lastname, firstname, phone_number, otherphone_number
//
//   Livraison :
//     - delivery_address (avec location lat/lon)
//     - phonenumber (telephone garage livraison)
//
//   Facturation (entite a facturer) :
//     - name             "ETHIAS SA,c/o IMA BENELUX SA/NV"   ← payeur legal
//     - corporatename    "IMA BENELUX"                        ← intermediaire
//     - vatcode          "BE0404484654"                       ← TVA
//     - address          adresse facturation
//
//   Adresse intervention :
//     - work_order_address (au niveau du job, pas dans workflow)
//     - complete_address (widget : meme info + code postal)

import type { KazeJob } from '@/lib/kaze/client'

// ── Helpers d extraction ────────────────────────────────────────────────────

/** Deballe une data widget Kaze : { value, version } -> value brute. */
function unwrap(d: any): any {
  if (d == null) return null
  if (typeof d === 'object' && 'value' in d) return d.value
  return d
}

/**
 * Parcours recursif de l arbre workflow Kaze et retourne une Map<id, valeur>.
 * Les widget_address sont expandes en deux entrees : <id> = adresse texte,
 * <id>__loc = "lat,lon".
 */
export function extractWidgets(workflow: any): Map<string, any> {
  const out = new Map<string, any>()

  function walk(node: any) {
    if (!node || typeof node !== 'object') return

    const type = node.type
    const id   = node.id

    if (typeof type === 'string' && type.startsWith('widget_') && id) {
      const data = unwrap(node.data)
      if (data != null) out.set(id, data)
      // widget_address : extraire aussi la location
      if (type === 'widget_address' && node.location) {
        const loc = unwrap(node.location)
        if (loc) out.set(`${id}__loc`, loc)
      }
    }

    // Recurse children
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c)
    }
  }

  walk(workflow)
  return out
}

// ── Helpers de normalisation ────────────────────────────────────────────────

function s(v: any): string | null {
  if (v == null) return null
  const str = String(v).trim()
  return str.length ? str : null
}

function num(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Telephone : Kaze envoie soit un int (32499296404) soit une string. On
 * normalise en format E.164 "+32499296404".
 */
function phone(v: any): string | null {
  if (v == null) return null
  let raw = String(v).replace(/[^0-9+]/g, '')
  if (!raw) return null
  if (!raw.startsWith('+')) raw = '+' + raw
  return raw
}

/**
 * Adresse Kaze : "R BIOLLEY 62, VERVIERS, 4800, BEL" -> { street, city, postal_code, country_code }
 * Format observe : virgule comme separateur, "BEL" comme code pays.
 */
function parseAddress(addr: string | null): {
  full:        string | null
  street:      string | null
  city:        string | null
  postal_code: string | null
  country:     string | null
} {
  if (!addr) return { full: null, street: null, city: null, postal_code: null, country: null }
  const parts = addr.split(',').map(p => p.trim()).filter(Boolean)
  // Heuristique : dernier element = code pays (3 lettres), avant-dernier = CP si numerique,
  // sinon = ville.
  const country = parts.length > 1 && parts[parts.length - 1].length === 3
    ? parts.pop()!
    : null
  let postal_code: string | null = null
  if (parts.length > 1 && /^\d{4,5}$/.test(parts[parts.length - 1])) {
    postal_code = parts.pop()!
  }
  const city   = parts.length > 1 ? parts.pop()! : null
  const street = parts.length > 0 ? parts.join(', ') : null
  return { full: addr, street, city, postal_code, country }
}

/** Extrait lat + lon depuis "50.593186,5.873229" */
function parseLatLon(loc: any): { lat: number | null; lon: number | null } {
  const s = unwrap(loc)
  if (typeof s !== 'string') return { lat: null, lon: null }
  const [latS, lonS] = s.split(',').map(v => v.trim())
  return { lat: num(latS), lon: num(lonS) }
}

/**
 * Mapping "Moyen" Kaze → { mission_type, incident_type }
 * - "Remorquage/Slepen"        → remorquage
 * - "Relivraison/Herlevering"  → remorquage + incident_type=relivraison
 * - "Depannage/Pechverhelping" → depannage
 * - "Trajet a vide/..."        → trajet_vide
 */
function mapMissionType(moyen: string | null): { mission_type: string; incident_type: string | null } {
  if (!moyen) return { mission_type: 'remorquage', incident_type: null }
  const m = moyen.toLowerCase()
  if (m.includes('relivraison') || m.includes('herlevering')) {
    return { mission_type: 'remorquage', incident_type: 'relivraison' }
  }
  if (m.includes('depannage') || m.includes('dépannage') || m.includes('pechverhelping')) {
    return { mission_type: 'depannage', incident_type: null }
  }
  if (m.includes('vide')) return { mission_type: 'trajet_vide', incident_type: null }
  return { mission_type: 'remorquage', incident_type: null }
}

/**
 * Extrait le nom de l entite a facturer depuis le widget "name" :
 *   "ETHIAS SA,c/o IMA BENELUX SA/NV"        → "ETHIAS SA"
 *   "VIVIUM SA, c/o IMA BENELUX SA/NV"       → "VIVIUM SA"
 *   "P&V Assurances,c/o IMA BENELUX..."      → "P&V Assurances"
 * On extrait la 1ere partie avant la virgule, puis on nettoie.
 */
function extractBillingEntityName(rawName: string | null): string | null {
  if (!rawName) return null
  const first = rawName.split(',')[0].trim()
  // On garde tel quel ; le lookup Odoo gere les variantes (ex "ETHIAS SA" vs "Ethias")
  return first || null
}

// ── Mapper principal ─────────────────────────────────────────────────────────

export interface MappedKazeMission {
  // Identifiants
  source:         'kaze'
  external_id:    string                  // job.id (UUID Kaze)
  kaze_job_id:    string                  // idem
  dossier_number: string | null           // job.reference (ex B61162516AA)

  // Type + meta
  mission_type:        string
  incident_type:       string | null
  incident_description:string | null

  // Adresse intervention
  incident_address:    string | null
  incident_city:       string | null
  incident_postal:     string | null
  incident_country:    string | null
  incident_lat:        number | null
  incident_lon:        number | null

  // Destination
  destination_name:    string | null
  destination_address: string | null

  // Vehicule
  vehicle_plate:       string | null
  vehicle_brand:       string | null
  vehicle_model:       string | null
  vehicle_fuel:        string | null
  vehicle_mileage:     number | null

  // Client (beneficiaire)
  client_name:         string | null
  client_phone:        string | null
  client_phone2:       string | null

  // Facturation (entite a payer, a lookup dans Odoo)
  billing_entity_name: string | null      // "ETHIAS SA" (a partir du widget name)
  billing_vat:         string | null      // "BE0404484654"
  billing_label_raw:   string | null      // libelle complet pour debug

  // Dates
  intervention_at:     string | null      // job.start_date

  // Meta pour audit / debug
  workflow_id:         string | null
  performer_kaze_id:   string | null
  performer_kaze_name: string | null
}

export function mapKazeJobToMission(job: KazeJob): MappedKazeMission {
  const widgets = extractWidgets(job.workflow)
  const w = (id: string) => widgets.get(id)

  // Adresse intervention : work_order_address est le resume, complete_address le detail
  const incident_raw   = s(w('complete_address')) || s(job.work_order_address?.address)
  const incident_parts = parseAddress(incident_raw)
  const incident_loc   = job.work_order_address?.location
    ? parseLatLon(job.work_order_address.location)
    : { lat: null, lon: null }

  // Destination (livraison)
  const dest_raw   = s(w('delivery_address'))
  const dest_parts = parseAddress(dest_raw)
  // Heuristique : si la premiere virgule sépare un nom de garage de l adresse,
  // on capture le nom — ex "CAR AV NISSAN VERVIERS, Rue Vovegnez 33, ..."
  // On considere que le premier element est le nom si la 2eme partie ressemble
  // a une adresse (chiffre + rue).
  let destination_name: string | null = null
  let destination_address = dest_raw
  if (dest_raw) {
    const parts = dest_raw.split(',').map(p => p.trim()).filter(Boolean)
    if (parts.length >= 3 && /\d/.test(parts[1] || '')) {
      destination_name    = parts[0]
      destination_address = parts.slice(1).join(', ')
    }
  }

  // Type de mission
  const { mission_type, incident_type } = mapMissionType(s(w('meanscode')))

  // Client
  const lastname  = s(w('lastname'))
  const firstname = s(w('firstname'))
  const client_name = [firstname, lastname].filter(Boolean).join(' ').trim() || null

  // Description panne
  const incident_description = [
    s(w('clienteffect')),
    s(w('prediagnostic')),
    s(w('eventorigin_precision')),
  ].filter(Boolean).join(' — ') || null

  // Facturation
  const billing_label_raw   = s(w('name'))
  const billing_entity_name = extractBillingEntityName(billing_label_raw)
  const billing_vat         = s(w('vatcode'))

  return {
    source:         'kaze',
    external_id:    job.id,
    kaze_job_id:    job.id,
    dossier_number: s(job.reference),

    mission_type,
    incident_type,
    incident_description,

    incident_address: incident_parts.full,
    incident_city:    incident_parts.city,
    incident_postal:  incident_parts.postal_code,
    incident_country: incident_parts.country,
    incident_lat:     incident_loc.lat,
    incident_lon:     incident_loc.lon,

    destination_name,
    destination_address,

    vehicle_plate:   s(w('registrationnumber')),
    vehicle_brand:   s(w('brand')),
    vehicle_model:   s(w('model')),
    vehicle_fuel:    s(w('energy')),
    vehicle_mileage: num(w('mileage')),

    client_name,
    client_phone:  phone(w('phone_number')),
    client_phone2: phone(w('otherphone_number')),

    billing_entity_name,
    billing_vat,
    billing_label_raw,

    intervention_at: s(job.start_date as any) || s(job.due_date as any),

    workflow_id:         s((job as any).job_workflow_id),
    performer_kaze_id:   s(job.performer?.id),
    performer_kaze_name: s(job.performer?.name),
  }
}
