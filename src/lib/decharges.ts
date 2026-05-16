// src/lib/decharges.ts
//
// Catalogue typé des 13 décharges utilisées par Verviers Dépannage.
// Format figé en code (Phase 1). Phase 2 (optionnelle) : page admin pour
// editer les textes sans recompiler.
//
// IMPORTANT : les textes sont juridiques. Toute modification doit etre
// validee par Olivier / l equipe legale.

export type DischargeColor = 'red' | 'green'

export interface DischargeType {
  /** Slug unique stocke dans discharge_data[].type_key */
  key:            string
  /** Libelle court affiche dans la dropdown chauffeur */
  label:          string
  /** Titre formel rendu en tete de la decharge dans le PDF */
  title:          string
  /** Texte juridique principal (peut contenir plusieurs paragraphes \n\n) */
  body:           string
  /** Note bas de page eventuelle (ex: "NE PAS OUBLIER DE FAIRE LES PHOTOS DES DEGATS") */
  footnote?:      string
  /** Label personnalise sous le champ nom (ex: "NOM DU CLIENT RECEPTIONNAIRE") */
  nameFieldLabel?: string
  /** Couleur d accent : rouge (decharge classique) ou vert (fin d intervention) */
  color:          DischargeColor
  /** Le commentaire est-il requis (motif, description du risque, etc.) */
  needsComment:   boolean
  /** Label du champ commentaire si needsComment */
  commentLabel?:  string
  /** La decharge requiert-elle des photos jointes */
  needsPhotos:    boolean
  /** Hint affiche pour les photos */
  photosHint?:    string
  /** La decharge requiert-elle un schema annote des degats (4 vues voiture) */
  needsSchema?:   boolean
}

export const DISCHARGE_TYPES: readonly DischargeType[] = [
  {
    key:    'remorquage_vh_dommages',
    label:  'Remorquage véhicule présentant des dommages',
    title:  'REMORQUAGE VÉHICULE PRÉSENTANT DES DOMMAGES',
    body:   'Le client reconnaît par la présente que les dommages repris sur le schéma annexe sont présents sur le véhicule et ne sont pas de la responsabilité de la société Verviers Dépannage ou de son personnel.',
    footnote: 'Annoter le schéma + photos des dégâts.',
    color:  'red',
    needsComment: false,
    needsPhotos:  true,
    photosHint:   'Photos des dégâts existants AVANT prise en charge',
    needsSchema:  true,
  },
  {
    key:    'livraison_domicile_client',
    label:  'Livraison au domicile du client',
    title:  'LIVRAISON AU DOMICILE DU CLIENT',
    body:   'Le client reconnaît par sa signature de cette décharge que son véhicule a été livré en bon état.',
    nameFieldLabel: 'Nom du client réceptionnaire',
    color:  'red',
    needsComment: false,
    needsPhotos:  false,
  },
  {
    key:    'ouverture_portes',
    label:  'Ouverture de portes (casser une vitre)',
    title:  'DÉCHARGE OUVERTURE DE PORTES (CASSER UNE VITRE)',
    body:   'Par sa signature, le client autorise le dépanneur à casser une vitre du véhicule pour procéder à l\'ouverture de celui-ci.',
    nameFieldLabel: 'Nom du client',
    color:  'red',
    needsComment: false,
    needsPhotos:  false,
  },
  {
    key:    'refus_reception_garage',
    label:  'Refus de réception par le garage',
    title:  'REFUS DE RÉCEPTION D\'UN VÉHICULE PAR LE GARAGE',
    body:   'Par sa signature, le garage réceptionnaire confirme qu\'il refuse la réception du véhicule.',
    nameFieldLabel: 'Nom de la personne qui refuse',
    color:  'red',
    needsComment: true,
    commentLabel: 'Motif (si possible)',
    needsPhotos:  false,
  },
  {
    key:    'depot_voie_publique',
    label:  'Dépôt sur voie publique',
    title:  'DÉPÔT D\'UN VÉHICULE SUR LA VOIE PUBLIQUE',
    body:   'À la demande express du client, le véhicule est laissé sur le domaine public sous son entière responsabilité et décharge la société Verviers Dépannage de toute responsabilité en cas de dommages subis sur le véhicule.',
    color:  'red',
    needsComment: false,
    needsPhotos:  false,
  },
  {
    key:    'enlevement_police_sans_client',
    label:  'Enlèvement police sans client',
    title:  'DEMANDE D\'ENLÈVEMENT D\'UN VÉHICULE PAR L\'AUTORITÉ SANS LA PRÉSENCE DU CLIENT',
    body:   'L\'enlèvement du véhicule est effectué par la société de dépannage sans la présence du client et à la demande de l\'autorité.',
    nameFieldLabel: 'Nom du demandeur (autorité)',
    color:  'red',
    needsComment: false,
    needsPhotos:  false,
  },
  {
    key:    'enlevement_au_garage',
    label:  'Enlèvement d\'un véhicule au garage',
    title:  'ENLÈVEMENT D\'UN VÉHICULE AU GARAGE',
    body:   'Le garage réceptionnaire reconnaît que la société Verviers Dépannage a enlevé le véhicule en sa concession et réalisé en sa présence l\'inspection du véhicule.',
    nameFieldLabel: 'Nom de la personne qui réceptionne',
    color:  'red',
    needsComment: false,
    needsPhotos:  false,
  },
  {
    key:    'fin_intervention_sans_degats',
    label:  'Fin d\'intervention sans dégâts supplémentaires',
    title:  'FIN D\'INTERVENTION',
    body:   'Le client reconnaît par la présente qu\'aucun dommage supplémentaire n\'est à déplorer suite à l\'intervention de la société Verviers Dépannage.',
    color:  'green',
    needsComment: false,
    needsPhotos:  false,
  },
  {
    key:    'livraison_au_garage',
    label:  'Livraison au garage',
    title:  'LIVRAISON D\'UN VÉHICULE AU GARAGE',
    body:   'Le garage réceptionnaire reconnaît que la société Verviers Dépannage a livré le véhicule en sa concession et réalisé en sa présence l\'inspection du véhicule.',
    nameFieldLabel: 'Nom de la personne qui réceptionne',
    color:  'red',
    needsComment: false,
    needsPhotos:  false,
  },
  {
    key:    'dsp_avec_risques',
    label:  'DSP avec risques',
    title:  'DÉPANNAGE SUR PLACE PRÉSENTANT UN/DES RISQUES',
    body:   'Le client demande le dépannage sur place de son véhicule et dégage la société Verviers Dépannage et son personnel de toute responsabilité en cas de dommages subis sur le véhicule lors de l\'intervention.',
    color:  'red',
    needsComment: true,
    commentLabel: 'Description du/des risque(s)',
    needsPhotos:  false,
  },
  {
    key:    'dsp_provisoire',
    label:  'DSP provisoire',
    title:  'DÉPANNAGE SUR PLACE PROVISOIRE',
    body:   'Par sa signature, le client reconnaît avoir été informé que le dépannage effectué par nos services est un dépannage provisoire.\n\nLe client s\'engage à aller directement au garage pour effectuer le contrôle ou la réparation de son véhicule.\n\nVerviers Dépannage et son personnel ne pourront pas être tenus responsables si le passage par le garage n\'est pas effectué directement.',
    color:  'red',
    needsComment: false,
    needsPhotos:  false,
  },
  {
    key:    'vh_laisse_sur_place',
    label:  'Véhicule laissé sur place',
    title:  'DÉCHARGE VÉHICULE LAISSÉ SUR PLACE',
    body:   'À la demande express du client, le véhicule est laissé sur place.',
    color:  'red',
    needsComment: false,
    needsPhotos:  false,
  },
  {
    key:    'declaration_degats_intervention',
    label:  'Déclaration de dégâts effectués sur le véhicule',
    title:  'LORS DE L\'INTERVENTION DE VERVIERS DÉPANNAGE, LE VÉHICULE A SUBI UN/DES DOMMAGE(S)',
    body:   'Le client reconnaît par la présente que le(s) dommage(s) repris sur le schéma suivant correspond(ent) totalement au(x) dégât(s) engendré(s).',
    footnote: 'Annoter le schéma + détails dans le commentaire + photos des dégâts.',
    color:  'red',
    needsComment: true,
    commentLabel: 'Détail des dommages',
    needsPhotos:  true,
    photosHint:   'Photos précises des dommages causés pendant l\'intervention',
    needsSchema:  true,
  },
] as const

export function getDischarge(key: string): DischargeType | null {
  return DISCHARGE_TYPES.find(d => d.key === key) ?? null
}

/**
 * Format persiste dans incoming_missions.discharge_data (jsonb).
 * Compatible avec l ancien format `{motif, name, sig}` (legacy, sans type_key).
 */
export interface DischargeEntry {
  /** Cle du catalogue (absente sur les anciennes decharges = motif libre legacy) */
  type_key?:    string
  /** Texte libre - utilise par les anciennes decharges OU comme commentaire pour les nouvelles */
  motif?:       string
  /** Nom du signataire (varie selon le type, cf nameFieldLabel) */
  name?:        string
  /** Signature client (data URL PNG) */
  sig?:         string
  /** Photos rattachees a CETTE decharge (URLs Supabase Storage) */
  photo_urls?:  string[]
  /** Schemas de degats annotes (5 vues : dessus + 4 cotes) — data URL ou URL Storage */
  schema_urls?: { top?: string; front?: string; back?: string; left?: string; right?: string }
  /** Date d ajout */
  created_at?:  string
}
