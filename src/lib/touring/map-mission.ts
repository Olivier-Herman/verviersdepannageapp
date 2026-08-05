// src/lib/touring/map-mission.ts
//
// Mappe une mission COMEX (détail rest/Mission/detail/get) → payload d'insertion
// incoming_missions (source 'touring'). Données STRUCTURÉES → aucun appel Claude.
// Coordonnées fournies par COMEX (LATITUDE/LONGITUDE) → pas de géocodage.
//
// Sémantique VD Soft : client_name = personne à joindre sur place (INT_*),
// assisted_name = membre Touring (MEM_*), billed_to = Touring (paie).

import { mapComexVr } from './vr'

const s = (v: any): string | null => {
  const t = v == null ? '' : String(v).trim()
  return t ? t : null
}
const num = (v: any): number | null => {
  const t = s(v)
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const joinAddr = (rue: any, numRue: any, cp: any, loc: any): string | null => {
  const street = [s(rue), s(numRue)].filter(Boolean).join(' ')
  const city   = [s(cp), s(loc)].filter(Boolean).join(' ')
  const full   = [street, city].filter(Boolean).join(', ')
  return full || null
}
const name = (prenom: any, nom: any): string | null => {
  const n = [s(prenom), s(nom)].filter(Boolean).join(' ')
  return n || null
}

/**
 * Touring annonce lui-même que le véhicule n'est pas couvert : c'est un dossier
 * Siabis non couvert, pas un dossier Touring. On matche sur CID_PROD (code
 * produit, insensible à la langue) avec le libellé en filet de sécurité.
 * Vérifié le 05/08/2026 : sur les 55 dossiers non couverts en base, le code
 * 1050101 et le libellé « VEHICULE PAS COUVERT » se recouvrent exactement.
 */
export const COMEX_PROD_NON_COUVERT = '1050101'

export function comexVehiculeNonCouvert(d: Record<string, any>): boolean {
  if (String(d?.CID_PROD ?? '').trim() === COMEX_PROD_NON_COUVERT) return true
  return /pas\s+couvert|niet\s+gedekt|not\s+covered/i.test(String(d?.LIB_PROD ?? ''))
}

/**
 * Véhicule de remplacement PROPOSÉ PAR TOURING POUR CETTE MISSION.
 *
 * COMEX envoie `LST_CODE_END_MIS` : la liste des codes de clôture que Touring
 * autorise sur ce dossier précis. Si un code « + VR » y figure, Touring accepte
 * qu'on clôture avec un véhicule de remplacement — donc le membre y a droit ici.
 *
 * Libellés relevés dans COMEX le 05/08/2026 (combo Dojo `detailInfosEndMission`,
 * lu dans le magasin Dojo du widget — le <select> visible dans le HTML est un
 * vestige commenté et vide) :
 *   00 Fin de tache            02 Fin de tache + Remorquage
 *   03 Fin de tache + Rem + VR    ← VR      04 Fin de tache + VR        ← VR
 *   06 Fin dep tel             07 Fin de REM transformé en DEP
 *   33 Fin dep tel + VR           ← VR      34 Fin de tache + Rem + Taxi
 *   35 Fin de tache + Rem + VR + Taxi ← VR  36 Refus garage
 *   20/21/23/24/25/28/29/40 = annulations
 *   05 = seul code encore sans libellé. Il n'apparaît que sur la liste « 00;05 »,
 *   celle des dossiers « VEHICULE PAS COUVERT » — dont on sait par ailleurs
 *   qu'ils n'ont aucun contrat. Risque résiduel : 1 mission sur 652.
 *
 * POURQUOI CE SIGNAL ET PAS LES DRAPEAUX FL_DEMANDE_*. Mesuré sur 652 missions :
 * la liste prend 8 valeurs distinctes, et les 55 dossiers « VEHICULE PAS COUVERT »
 * n'en proposent AUCUN avec VR — zéro faux positif. Croisée avec la base des
 * contrats (Prestex FDDS), elle concorde à 90 % contre 64 % pour les drapeaux.
 * Les écarts restants sont attendus : Prestex décrit le CONTRAT (« ce contrat
 * prévoit-il un VR ? »), la liste décrit LA MISSION (« Touring en propose-t-il un
 * ici ? »), et un contrat qui couvre le VR en panne mais pas en vol produit
 * exactement cet écart sur un dossier vol. C'est la question mission qui compte.
 */
export const COMEX_CODES_FIN_VR = ['03', '04', '33', '35']

export function comexVrPropose(d: Record<string, any>): boolean | null {
  const brut = s(d?.LST_CODE_END_MIS)
  if (!brut) return null                       // pas d'info → « ? », jamais « non »
  const codes = brut.split(';').map(x => x.trim())
  return COMEX_CODES_FIN_VR.some(c => codes.includes(c))
}

/** LIB_GAR / type COMEX → mission_type VD Soft. */
export function comexMissionType(libGar: any): 'remorquage' | 'depannage' {
  const t = (s(libGar) || '').toLowerCase()
  if (t.includes('remorqu') || t.includes('takel') || t.includes('transp')) return 'remorquage'
  return 'depannage'   // Dépannage / Panne sur place par défaut
}

/** Date COMEX "2026-07-04T16:44:42.000" → ISO utilisable. */
function comexDate(v: any): string | null {
  const t = s(v)
  if (!t) return null
  // Déjà ISO-like ; on force un offset Bruxelles si absent.
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.replace(/\.\d+$/, '')}+02:00`
}

export interface ComexMapInput {
  /** objet `content` de rest/Mission/detail/get */
  detail:   Record<string, any>
  /** statut VD Soft déjà décidé par l'import selon COD_STATUT_MTR */
  status:   string
  /** billed_to par défaut (catalog source touring) */
  billedToId?:   string | null
  billedToName?: string | null
}

/** Construit le payload incoming_missions (insert) depuis une mission COMEX. */
export function mapComexToMission(input: ComexMapInput): Record<string, any> {
  const d = input.detail || {}
  const dossier = s(d.CID_DOS) || ''
  const seq     = s(d.CID_SEQ_ACTION) || ''
  // external_id = NUM_COMMANDE (la même réf « …MA » que les mails Touring) pour
  // dédoublonner COMEX ↔ email (roue de secours). Repli sur CID_DOS/SEQ.
  const numCommande = s(d.NUM_COMMANDE)
  const externalId = numCommande || (seq ? `${dossier}/${seq}` : dossier)

  const nowIso = new Date().toISOString()

  return {
    external_id:        externalId,
    dossier_number:     dossier || null,
    // Touring dit « véhicule pas couvert » → la fiche est un Siabis non couvert
    // dès l'import, plus besoin de la reclasser à la main.
    source:             comexVehiculeNonCouvert(d) ? 'police_snc' : 'touring',
    source_format:      'comex',
    status:             input.status,
    mission_type:       comexMissionType(d.LIB_GAR),
    // Description sinistre COMEX (texte riche, langue du membre) → incident_description.
    incident_type:        s(d.LIB_CAUSE_SIN),                 // "Panne" / …
    incident_description: s(d.DESCR_SIN) || s(d.LIB_CAUSE_SIN),

    // Client = personne à joindre sur place (intervenant), membre = assisté.
    client_name:        name(d.INT_PRENOM, d.INT_NOM) || name(d.MEM_PRENOM, d.MEM_NOM) || s(d.NOM),
    client_phone:       s(d.INT_NTEL) || s(d.NTEL),
    // NB : pas de colonne client_email sur incoming_missions → ne pas l'ajouter
    // (échec insert PGRST204). Olivier 2026-07-07.
    assisted_name:      name(d.MEM_PRENOM, d.MEM_NOM),

    // Véhicule
    vehicle_plate:      (s(d.NUM_PLAQUE) || '').replace(/\s/g, '').toUpperCase() || null,
    vehicle_brand:      s(d.LIB_MARQUE),
    vehicle_model:      s(d.LIB_MODELE),
    vehicle_vin:        s(d.NUM_CHASSIS),
    vehicle_fuel:       s(d.LIB_CARBUR_VEH),
    vehicle_gearbox:    s(d.LIB_BOITE_VEH),

    // Prise en charge (avec coords COMEX → pas de géocodage)
    incident_address:   joinAddr(d.RUE, d.NUM_RUE, d.CP, d.LOC),
    incident_city:      s(d.LOC),
    incident_lat:       num(d.LATITUDE),
    incident_lng:       num(d.LONGITUDE),

    // Destination
    destination_name:    s(d.TO_NOM),
    destination_address: joinAddr(d.TO_RUE, d.TO_NUM_RUE, d.TO_CP, d.TO_LOC),
    destination_lat:     num(d.TO_LATITUDE),
    destination_lng:     num(d.TO_LONGITUDE),

    // Facturation : Touring paie (billed_to par défaut du catalog).
    ...(input.billedToId ? { billed_to_id: input.billedToId, billed_to_name: input.billedToName } : {}),

    // Code contrat Touring (aussi présent dans les mails). C'est la SEULE donnée
    // COMEX fiable sur les droits : elle ouvre la fiche contrat dans Prestex FDDS,
    // conservé pour la traçabilité et l'affichage (nom du programme sur la fiche).
    contract_code:      s(d.CID_PROD),
    contract_label:     s(d.LIB_PROD),

    // Droit au véhicule de remplacement POUR CETTE MISSION (cf. comexVrPropose).
    vr_proposed:        comexVrPropose(d),

    // Traçabilité : on garde la source brute (JSON COMEX) → pas de Claude, et le
    // document « source » de la fiche fonctionne.
    // Droits VR / taxi / shuttle du membre Touring (dispo dès l'acceptation).
    // Valeurs COMEX brutes conservées (9 = proposable, 0 = non, 10 = proactif) →
    // l'affichage dérive l'éligibilité (cf. lib/touring/vr.ts). Olivier 2026-08-03.
    touring_vr:         mapComexVr(d),

    parse_confidence:   1.0,
    raw_content:        JSON.stringify(d).slice(0, 10000),
    received_at:        comexDate(d.D_SEND) || comexDate(d.D_CREATION) || nowIso,
    intervention_date:  comexDate(d.D_CREATION) || nowIso,
  }
}

// force deploy 1783451560
