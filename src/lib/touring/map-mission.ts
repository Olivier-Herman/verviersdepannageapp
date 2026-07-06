// src/lib/touring/map-mission.ts
//
// Mappe une mission COMEX (détail rest/Mission/detail/get) → payload d'insertion
// incoming_missions (source 'touring'). Données STRUCTURÉES → aucun appel Claude.
// Coordonnées fournies par COMEX (LATITUDE/LONGITUDE) → pas de géocodage.
//
// Sémantique VD Soft : client_name = personne à joindre sur place (INT_*),
// assisted_name = membre Touring (MEM_*), billed_to = Touring (paie).

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
    source:             'touring',
    source_format:      'comex',
    status:             input.status,
    mission_type:       comexMissionType(d.LIB_GAR),
    // Description sinistre COMEX (texte riche, langue du membre) → incident_description.
    incident_type:        s(d.LIB_CAUSE_SIN),                 // "Panne" / …
    incident_description: s(d.DESCR_SIN) || s(d.LIB_CAUSE_SIN),

    // Client = personne à joindre sur place (intervenant), membre = assisté.
    client_name:        name(d.INT_PRENOM, d.INT_NOM) || name(d.MEM_PRENOM, d.MEM_NOM) || s(d.NOM),
    client_phone:       s(d.INT_NTEL) || s(d.NTEL),
    client_email:       s(d.INT_EMAIL),
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

    // Traçabilité : on garde la source brute (JSON COMEX) → pas de Claude, et le
    // document « source » de la fiche fonctionne.
    parse_confidence:   1.0,
    raw_content:        JSON.stringify(d).slice(0, 10000),
    received_at:        comexDate(d.D_SEND) || comexDate(d.D_CREATION) || nowIso,
    intervention_date:  comexDate(d.D_CREATION) || nowIso,
  }
}
