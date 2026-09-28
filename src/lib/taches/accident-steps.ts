// src/lib/taches/accident-steps.ts
//
// Process « Accident sur appel police » — les questions, dans l'ordre, telles
// qu'Olivier les a validées le 28/09/2026. Module partagé client/serveur :
// aucune dépendance Supabase ici, seulement la logique « quelle est la
// prochaine question ? ».
//
// Règles :
//   • une question à la fois, un clic ; « Valider » seulement s'il faut taper ;
//   • ce que l'app sait déjà est affiché, pas demandé (étiquette imprimée…) ;
//   • propriétaire et assurance ne viennent QUE des documents scannés ou du
//     client qui se fait connaître : sans eux, la prise en charge s'arrête
//     après les photos (puis la zone) et le véhicule passe « en attente du
//     propriétaire » ;
//   • le questionnaire s'arrête à l'ouverture du dossier d'assistance. La
//     suite (sortie, relances, expert, facturation) vit dans la fiche.

export type StepId =
  | 'label' | 'zone' | 'key' | 'docs' | 'scan' | 'check' | 'photos'
  | 'cover' | 'contact' | 'assistance'

export interface Answers {
  label?:      'oui' | 'reprint'
  zone?:       'keep' | 'transfer'
  zone_key?:   string
  key?:        'in_vehicle' | 'hook' | 'office' | 'no_key'
  key_hook?:   string
  docs?:       'oui' | 'non'
  scan?:       'fait' | 'plus_tard'
  check?:      'oui' | 'corriger'
  photos?:     'non' | 'ajoutees'
  cover?:      'ethias_kaze' | 'autre' | 'aucune'
  cover_name?: string
  forfait220?: boolean
  contact?:    'joint' | 'message' | 'injoignable'
  assistance?: 'oui' | 'non' | 'pas_agree'
  assistance_key?:  string
  assistance_name?: string
  assistance_ref?:  string
  assistance_opened_now?: boolean
  /** Lu sur les photos du chauffeur pour la fiche d'appel à l'assistance. */
  vehicle_look?: { color?: string | null; gearbox?: string | null; brand?: string | null; model?: string | null; at?: string }
  redelivery_address?: string
  /** Le propriétaire s'est fait connaître (comptoir, téléphone, police). */
  client?:     boolean
}

export interface Reading {
  documents?: { type: string; present: boolean; note?: string }[]
  owner?:     { name?: string | null; address?: string | null; phone?: string | null; email?: string | null }
  insurer?:   { name?: string | null; policy?: string | null; valid_until?: string | null }
  assistance?: string | null
  ct_valid_until?: string | null
  vin?:  string | null
  plate?: string | null
  notes?: string | null
}

/** Sait-on QUI contacter ? (documents lus, client manifesté, ou fiche déjà renseignée) */
export function ownerKnown(a: Answers, reading: Reading | null | undefined, mission: { client_phone?: string | null; client_email?: string | null }): boolean {
  if (a.client) return true
  if (reading?.owner?.name) return true
  return !!(mission.client_phone || mission.client_email)
}

/** Les étapes applicables à ce véhicule, dans l'ordre. */
export function stepsFor(a: Answers, reading: Reading | null | undefined, mission: { client_phone?: string | null; client_email?: string | null }): StepId[] {
  const s: StepId[] = ['label', 'key', 'docs']
  if (a.docs === 'oui') s.push('scan')
  if (a.docs === 'oui' && a.scan === 'fait') s.push('check')
  s.push('photos')
  if (ownerKnown(a, reading, mission)) {
    s.push('cover')
    if (mission.client_phone || mission.client_email || reading?.owner?.phone || reading?.owner?.email) s.push('contact')
    s.push('assistance')
  }
  // La zone EN DERNIER (Olivier 28/09/2026) : une adresse de relivraison fait
  // basculer le véhicule en zone K toute seule ; poser la question avant, c'est
  // le déplacer deux fois pour un véhicule qui ne bouge qu'une fois.
  s.push('zone')
  return s
}

export function nextStep(a: Answers, reading: Reading | null | undefined, mission: { client_phone?: string | null; client_email?: string | null }): StepId | null {
  return stepsFor(a, reading, mission).find(id => (a as any)[id] == null) || null
}

/** Statut du run après une réponse. */
export function runStatus(a: Answers, reading: Reading | null | undefined, mission: { client_phone?: string | null; client_email?: string | null }): 'todo' | 'waiting_owner' | 'done' {
  const next = nextStep(a, reading, mission)
  if (next) return 'todo'
  return ownerKnown(a, reading, mission) ? 'done' : 'waiting_owner'
}

export function progress(a: Answers, reading: Reading | null | undefined, mission: { client_phone?: string | null; client_email?: string | null }): { done: number; total: number } {
  const st = stepsFor(a, reading, mission)
  return { done: st.filter(id => (a as any)[id] != null).length, total: st.length }
}

/** Libellé court de la prochaine question, pour la liste des véhicules. */
export const STEP_LABELS: Record<StepId, string> = {
  label:      'Étiquette collée ?',
  zone:       'Où ranger le véhicule ?',
  key:        'Où est la clé ?',
  docs:       'Documents à bord ?',
  scan:       'Scanner les documents',
  check:      'Vérifier la lecture',
  photos:     'Photos',
  cover:      'Couverture d’assistance',
  contact:    'Contacter le propriétaire',
  assistance: 'Dossier d’assistance',
}

/** Nos réponses « clé » → les valeurs de la fiche (lib/key-location). */
export const KEY_ANSWER_TO_FICHE: Record<NonNullable<Answers['key']>, string> = {
  in_vehicle: 'in_vehicle',
  hook:       'bureau_rac',
  office:     'bureau_rac',
  no_key:     'no_key',
}

/** Libellés des documents reconnus par la lecture (partagé avec l'écran : rien de serveur ici). */
export const DOCUMENT_LABELS: Record<string, string> = {
  certificat_immatriculation: 'Certificat d’immatriculation',
  carte_verte:                'Carte verte / assurance',
  controle_technique:         'Contrôle technique',
  carnet_entretien:           'Carnet d’entretien',
  autre:                      'Autre document',
}
