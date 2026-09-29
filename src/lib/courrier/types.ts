// src/lib/courrier/types.ts — vocabulaire du module Courrier (partagé client-serveur).
// Olivier 29/09/2026 (maquette v2 validée).

export const ENTITIES = {
  vd:   { label: 'Verviers Dépannage', short: 'VD' },
  riga: { label: 'Dépannage Riga',     short: 'Riga' },
  dgj:  { label: 'DGJ VHU',            short: 'DGJ VHU' },
} as const
export type EntityKey = keyof typeof ENTITIES

export const DOC_TYPES = {
  requisitoire:        'Réquisitoire / levée de saisie',
  amende:              'Amende',
  facture_fournisseur: 'Facture fournisseur',
  assureur:            'Courrier d’assureur ou d’assistance',
  justice:             'Justice, convocation, huissier',
  administration:      'Administration (SPF, registre, commune)',
  banque:              'Banque ou assurance de la société',
  client:              'Courrier d’un client',
  publicite:           'Publicité',
  autre:               'Autre',
} as const
export type DocType = keyof typeof DOC_TYPES

/** Gestes que l'agent sait faire. Chaque étape porte sa phrase lisible (label). */
export type StepKind = 'attach_mission' | 'requisitoire_received' | 'task' | 'notify' | 'draft_reply' | 'supplier_invoice' | 'file_only'
export interface PlanStep {
  kind:   StepKind
  label:  string
  params: Record<string, any>
}
export interface StepResult { kind: StepKind; ok: boolean; note: string }

export interface CourrierReading {
  sender:        string | null
  sender_email:  string | null
  addressed_to:  string | null
  entity:        EntityKey | null
  entity_conf:   number
  doc_type:      DocType
  type_conf:     number
  summary:       string
  plate:         string | null
  vin:           string | null
  reference:     string | null
  amount_eur:    number | null
  due_date:      string | null
  doc_date:      string | null
  handwritten:   boolean
  facts:         [string, string][]
}

/** Clé d'expéditeur pour retenir les procédures (minuscules, sans ponctuation ni forme juridique). */
export function senderKey(name: string | null | undefined): string | null {
  const s = String(name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(sa|sprl|srl|nv|bv|bvba|scrl|asbl|sas|gmbh|ltd)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim()
  return s.length >= 3 ? s : null
}
