// src/lib/cloture/outcomes.ts
//
// Les ISSUES possibles d'une mission une fois le chauffeur sur place — le menu
// de la page « Action ». Olivier 2026-08-11.
//
// Deux notions à ne pas confondre :
//   • ISSUE (outcome) : ce qui s'est passé. Elle détermine le code de fin de
//     mission ET la BRANCHE de motifs (mobilité rétablie / remorquage).
//   • PRISE EN CHARGE (Siabis couvert / non couvert) : un MARQUEUR de tarif, pas
//     une issue. La clôture derrière reste un dépannage ou un remorquage normal.
//
// Le menu est CONTEXTUEL : on ne montre que les issues valides pour cette fiche.

export type Branch = 'mobilite' | 'remorquage'

export type Outcome =
  | 'dsp'        // dépannage réussi, le véhicule repart          → fin 00
  | 'rem'        // transformation en remorquage                  → fin 02
  | 'rem_vr'     // remorquage + véhicule de remplacement         → fin 03
  | 'rem2dsp'    // dossier REM finalement réparé sur place       → fin 07
  | 'delivered'  // véhicule livré à destination (clôture jambe REM) → fin 00
  | 'park'       // mise en parc (fin remorquage + transfert)     → fin 05
  | 'dpr'        // déplacement pour rien (aucun code panne)      → code d'annulation

export interface OutcomeDef {
  key:    Outcome
  label:  string
  icon:   string
  /** Regroupement affiché sur la page Action. */
  group:  'repart' | 'repart_pas' | 'charge' | 'rien'
  /** Branche de motifs à proposer (null = pas de motif de panne à encoder). */
  branch: Branch | null
  /** Code COD_FIN_MISSION visé (le vrai code est intersecté avec LST_CODE_END_MIS). */
  fin:    string | null
}

export const OUTCOMES: Record<Outcome, OutcomeDef> = {
  dsp:     { key:'dsp',     label:'Clôturer — dépannage réussi',        icon:'🔧', group:'repart',      branch:'mobilite',   fin:'00' },
  rem2dsp: { key:'rem2dsp', label:'Finalement réparé — plus de remorquage', icon:'🔧', group:'repart',  branch:'mobilite',   fin:'07' },
  rem:     { key:'rem',     label:'Transformer en remorquage',          icon:'🚛', group:'repart_pas', branch:'remorquage', fin:'02' },
  rem_vr:  { key:'rem_vr',  label:'Remorquage + véhicule de remplacement', icon:'🚛', group:'repart_pas', branch:'remorquage', fin:'03' },
  delivered: { key:'delivered', label:'Véhicule livré à destination',    icon:'🏁', group:'charge',      branch:null,         fin:'00' },
  park:    { key:'park',    label:'Mise en parc',                       icon:'🅿️', group:'charge',      branch:'remorquage', fin:'05' },
  dpr:     { key:'dpr',     label:'Déplacement pour rien',              icon:'❌', group:'rien',        branch:null,         fin:null },
}

export interface MissionForOutcomes {
  mission_type?: string | null
  status?: string | null
  loaded_at?: string | null
  vr_proposed?: boolean | null
}

const isRemType = (t?: string | null) => !!t && /remorquage|rem\b|REM/i.test(t)

/**
 * Issues à proposer pour cette fiche. Un dossier déjà en remorquage ne peut pas
 * être « transformé en remorquage » : il devient « finalement réparé » (fin 07).
 */
export function availableOutcomes(m: MissionForOutcomes): OutcomeDef[] {
  const rem    = isRemType(m.mission_type)
  const loaded = !!m.loaded_at
  const out: OutcomeDef[] = []

  if (rem) {
    // ⚠️ NE PAS conditionner « livré » et « mise en parc » au pointage « véhicule
    // chargé ». Sur 30 jours : 93 mises en parc, dont 10 seulement avaient
    // `loaded_at`. Le pointage est facultatif dans les faits, et le gater dessus
    // privait 9 chauffeurs sur 10 de leur bouton parc — signalé par Franck et
    // Fred Palm le 14/08, au point de repasser en flux traditionnel.
    out.push(OUTCOMES.delivered)
    out.push(OUTCOMES.park)
    // « Finalement réparé » n'a de sens qu'AVANT le chargement : un véhicule sur
    // le plateau ne repart pas par ses propres moyens.
    if (!loaded) out.push(OUTCOMES.rem2dsp)
  } else {
    out.push(OUTCOMES.dsp)
    out.push(OUTCOMES.rem)
    if (m.vr_proposed === true) out.push(OUTCOMES.rem_vr)
  }
  out.push(OUTCOMES.dpr)
  return out
}

/**
 * Issues qui ne demandent AUCUN motif au chauffeur :
 *   • dpr       → le motif EST le code d'annulation ;
 *   • delivered → les codes ont été encodés à la 1re jambe, on les reprend.
 */
export function needsMotif(outcome: Outcome): boolean {
  return !!OUTCOMES[outcome]?.branch
}

/** Branche de motifs correspondant à une issue (null = déplacement pour rien). */
export function branchOf(outcome: Outcome): Branch | null {
  return OUTCOMES[outcome]?.branch ?? null
}

/** Une issue qui remorque le véhicule → la fiche VD Soft doit passer en remorquage. */
export function outcomeIsRem(outcome: Outcome): boolean {
  return outcome === 'rem' || outcome === 'rem_vr'
}

/**
 * Codes de fin « annulation » proposés pour un déplacement pour rien. Aucun code
 * panne n'est encodé (Olivier 2026-08-11) : le motif EST le code de fin. La liste
 * réelle est intersectée avec `LST_CODE_END_MIS` renvoyé par COMEX pour ce dossier.
 */
export const DPR_END_CODES: { code: string; label: string }[] = [
  { code: '20', label: 'Le client est parti avant mon arrivée' },
  { code: '21', label: "Le client refuse l'intervention" },
  { code: '29', label: 'Mauvaise adresse' },
  { code: '40', label: 'Matériel inadapté' },
  { code: '25', label: "Un autre dépanneur a été envoyé" },
  { code: '36', label: 'Garage fermé / refuse le véhicule' },
  { code: '27', label: 'Hors contrat' },
  { code: '22', label: 'Véhicule mal entretenu' },
]
