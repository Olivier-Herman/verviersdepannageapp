// Helper centralise pour construire les URL d encaissement precomplet a
// partir d une mission. Evite la duplication de mapping motif / prefill
// dans tous les composants qui ouvrent /encaissement.
//
// Olivier 2026-05-28 : tous les boutons "Encaisser" (fiche driver, hub QR,
// form chauffeur, etc.) doivent passer adresse + motif + precision pour
// que le module encaissement n exige plus de re-saisie manuelle.

// Mapping source -> label motif affiche dans encaissement (matche la
// liste motifs[] BD via prefill_motif_label).
const MOTIF_LABELS: Record<string, string> = {
  'police_mg':       'Mal Garée',
  'police_rodeo':    'Rodéo',
  'police_avp':      'AVP',
  'police_accident': 'Accident',
  'police_saisie':   'Saisie',
  'police_snc':      'Siabis',
  'sia_couvert':     'Siabis',
  'prive':           'Intervention Privée',
}

export interface EncaissementUrlMission {
  id:               string
  source?:          string | null
  vehicle_plate?:   string | null
  vehicle_brand?:   string | null
  vehicle_model?:   string | null
  incident_address?: string | null
  incident_city?:    string | null
}

export interface EncaissementUrlOptions {
  amount?:        number | null     // si fourni, set prefill_amount
  returnTo?:      string            // defaut: /mission/[id]
  extraPrecision?: string           // suffix ajoute a la precision motif (ex: scenario specifique)
}

/**
 * Construit l URL /encaissement?prefill_... avec tous les champs pertinents.
 * Le frontend EncaissementClient.tsx skip alors les pages plaque + lookup
 * vehicule + motif + adresse (= directement page paiement).
 */
export function buildEncaissementUrl(mission: EncaissementUrlMission, opts: EncaissementUrlOptions = {}): string {
  const plate = (mission.vehicle_plate || '').trim()
  const brand = mission.vehicle_brand || ''
  const model = mission.vehicle_model || ''
  const motifLabel = MOTIF_LABELS[mission.source || ''] || ''
  const motifPrecision = [motifLabel, plate.toUpperCase(), opts.extraPrecision].filter(Boolean).join(' — ')
  const location = [mission.incident_address, mission.incident_city].filter(Boolean).join(', ')
  const returnTo = opts.returnTo || `/mission/${mission.id}`

  const params = new URLSearchParams()
  params.set('prefill_mission_id', mission.id)
  if (plate) params.set('prefill_plate', plate)
  if (brand) params.set('prefill_brand', brand)
  if (model) params.set('prefill_model', model)
  if (opts.amount != null && opts.amount > 0) params.set('prefill_amount', String(opts.amount))
  if (location) params.set('prefill_location', location)
  if (motifLabel) params.set('prefill_motif_label', motifLabel)
  if (motifPrecision) params.set('prefill_motif_precision', motifPrecision)
  params.set('return_to', returnTo)

  return `/encaissement?${params.toString()}`
}
