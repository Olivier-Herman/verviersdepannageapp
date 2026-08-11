// src/lib/touring/close-presets.ts
//
// Presets de clôture CHAUFFEUR Touring COMEX. Le chauffeur choisit une panne
// courante ; on envoie à COMEX un triplet de codes « juste valides » (le dispatch
// affine ensuite sur la jambe remorquage qui revient dans VD Soft). Olivier 2026-08-06.
//
// ⚠️ CODES REFONDUS SUR LES USAGES RÉELS (audit Olivier 2026-08-11) — les codes
// ci-dessous ne sont plus « plausibles » mais MESURÉS : dépouillement de
// `touring_deroulement.arc_code` (colonne 17 du BKO = « cause desc result »),
// 6479 dossiers du 14/11/2024 au 06/08/2026 (3837 remorquages, 2354 dépannages).
// Les % en fin de ligne = part réelle de la branche. Enseignements :
//   • `355 39 73` (Moteur / Mal réglé) = LE code de remorquage n°1 (17 %) — il
//     manquait totalement ; `118 42 73` (Carrosserie/Accident, 15 %) était encodé
//     chez nous en `144 42 73` (8× moins utilisé).
//   • Crevaison DSP = `246 14 50` (441 usages) et non `246 14 61` (4 usages).
//   • Supprimés car JAMAIS utilisés en 21 mois : `247 24 57` (pneu regonflé),
//     `239 25 55` (antivol), `403 27 57` (cosses → vrai code `400 27 50`),
//     `313 73 73` (fouine), `515 41 73` (erreur carburant → vrai `515 23 73`).
//   • Le catch-all réel du dispatch (`999 46 99`) porte un RESULT 99 absent du
//     référentiel COMEX (donc non encodable par nous) → `999 46 50` / `999 46 73`.
// Référentiel officiel : /Comex/web/JavaScript/data/{codePanne,descPanne,
// resultPanne,endMission}.json (+ refComFaultrestrictions.json = types autorisés
// par cause). Tous les triplets ci-dessous ont été validés contre ces restrictions.
//
// RÈGLES :
//   • REM ou REM+VR ⟹ COD_PANNE_RESULT = '73' (Réparation sur route impossible), TOUJOURS.
//   • FIN : 00 = dépannage sur place · 02 = + remorquage · 03 = + rem + VR.
//   • La variante +VR d'un preset REM = même codes, FIN passe de '02' à '03' (withVr()).
//   • « Autre » (catch-all) se présente TOUJOURS EN DERNIER dans les listes (Olivier).
//   • Codes de repli (gérés à la clôture, PAS ici) : VIN invalide/vide → 17× 'X' ;
//     MEC absente → 2000-01-01 ; km vide → COD_NON_SAISIE_KM = '04' (Autre).

export interface ClosePreset {
  key:    string   // identifiant stable (UI + logs)
  label:  string   // libellé chauffeur
  icon:   string   // emoji (UI)
  cause:  string   // COD_PANNE_CAUSE (Code Incident)
  desc:   string   // COD_PANNE_DESC  (Code Type)
  result: string   // COD_PANNE_RESULT (Code Résultat)
  fin:    string   // COD_FIN_MISSION
  rem:    boolean  // true = remorquage (déclenche la 2e jambe COMEX + résout le garage)
}

/** COD_PANNE_RESULT figé pour tout remorquage. */
export const RESULT_REM_IMPOSSIBLE = '73'   // « Réparation sur route impossible »

/**
 * Référentiel « Fin de mission » (COD_FIN_MISSION) code→libellé — dump COMEX
 * 2026-08-06 (widget detailInfosEndMission), recoupé avec endMission.json
 * 2026-08-11. Une mission n'expose qu'un sous-ensemble via `LST_CODE_END_MIS`
 * (dynamique) → filtrer avec ça à l'affichage.
 */
export const END_MISSION_LABELS: Record<string, string> = {
  '00': 'Fin de tâche',
  '02': 'Fin de tâche, + Remorquage',
  '03': 'Fin de tâche, + Rem + VR',
  '04': 'Fin de tâche, + VR',
  '05': 'Fin Remorquage, + Transfert',   // REM mis en parc (clôture jambe remorquage → dépôt)
  '06': 'Fin dépannage téléphonique',
  '07': 'Fin de REM transformé en DEP',
  '11': 'Fin dép. tél. + Rem',
  '12': 'Fin dép. tél. + Rem + VR',
  '33': 'Fin dép. tél. + VR',
  '34': 'Fin de tâche + Rem + Taxi',
  '35': 'Fin de tâche + Rem + VR + Taxi',
  '36': 'Refus garage',
  '20': 'Annul. Sté partie avec déplacement',
  '21': 'Annul. Refus POU avec déplacement',
  '22': 'Annul. Mal entretenu',
  '23': 'Annul. Sté partie sans déplacement',
  '24': 'Annul. Refus POU sans déplacement',
  '25': 'Annul. envoyer quelqu’un d’autre',
  '26': 'Annul. Hors contrat sans dép.',
  '27': 'Annul. Hors contrat avec dép.',
  '28': 'Annul. mauvaise adresse sans dép.',
  '29': 'Annul. mauvaise adresse avec dép.',
  '40': 'Annul. matériel inadapté avec dép.',
}

/** Codes Fin de mission qui impliquent un remorquage (dépose garage/adresse). */
export const REM_FIN_CODES = new Set(['02', '03', '34', '35'])

/** Libellé d'un code Fin de mission (fallback « Code XX »). */
export function endMissionLabel(code: string): string {
  return END_MISSION_LABELS[code] || `Code ${code}`
}

// ── A) Dépannage sur place / mobilité rétablie — FIN 00 ──────────────────────
// Ordre = fréquence réelle décroissante. Couverture mesurée : 87,8 % des DSP.
export const PRESETS_DSP: ClosePreset[] = [
  { key: 'batt_boost',      label: 'Batterie à plat → redémarrée',              icon: '⚡', cause: '400', desc: '29', result: '59', fin: '00', rem: false }, // 44,5 %
  { key: 'crevaison_roue',  label: 'Crevaison → roue de secours',               icon: '🛞', cause: '246', desc: '14', result: '50', fin: '00', rem: false }, // 22,7 %
  { key: 'cosses_batt',     label: 'Cosses batterie desserrées → remises',      icon: '🔌', cause: '400', desc: '27', result: '50', fin: '00', rem: false }, //  2,7 %
  { key: 'moteur_repart',   label: 'Moteur remis en route',                     icon: '🔧', cause: '355', desc: '39', result: '50', fin: '00', rem: false }, //  2,3 %
  { key: 'embourbe',        label: 'Véhicule embourbé → dégagé',                icon: '🪵', cause: '999', desc: '48', result: '50', fin: '00', rem: false }, //  1,9 %
  { key: 'cles_habitacle',  label: 'Clés enfermées → ouverture',                icon: '🔑', cause: '680', desc: '36', result: '50', fin: '00', rem: false }, //  1,4 %
  { key: 'egr_admission',   label: 'Admission / EGR encrassée → nettoyée',      icon: '🌫️', cause: '380', desc: '15', result: '50', fin: '00', rem: false }, //  1,0 %
  { key: 'refroidissement', label: 'Liquide de refroidissement → appoint',      icon: '💧', cause: '300', desc: '17', result: '50', fin: '00', rem: false }, //  0,8 %
  { key: 'surchauffe_ok',   label: 'Surchauffe → refroidi, repart',             icon: '🌡️', cause: '355', desc: '22', result: '50', fin: '00', rem: false }, //  0,8 %
  { key: 'freins_debloq',   label: 'Freins bloqués → débloqués',                icon: '🛑', cause: '206', desc: '25', result: '50', fin: '00', rem: false }, //  0,8 %
  { key: 'voyant_elec',     label: 'Voyant / défaut électrique',                icon: '💡', cause: '439', desc: '30', result: '50', fin: '00', rem: false }, //  0,6 %
  { key: 'huile_moteur',    label: 'Huile moteur → appoint',                    icon: '🛢️', cause: '359', desc: '17', result: '50', fin: '00', rem: false }, //  0,4 %
  { key: 'accident_repart', label: 'Accident → véhicule repart',                icon: '💥', cause: '999', desc: '42', result: '50', fin: '00', rem: false }, //  0,4 %
  { key: 'panne_seche',     label: 'Panne sèche → ravitaillement',              icon: '⛽', cause: '515', desc: '17', result: '50', fin: '00', rem: false }, //  0,3 %
  { key: 'serrure_bloquee', label: 'Serrure / portière bloquée → ouverte',      icon: '🚪', cause: '661', desc: '25', result: '50', fin: '00', rem: false }, //  0,2 %
]

// Catch-all mobilité : le chauffeur a remis le véhicule en route sans que la
// panne colle à un preset. TOUJOURS présenté EN DERNIER.
export const PRESET_DSP_CATCHALL: ClosePreset = {
  key: 'dsp_autre', label: 'Autre → mobilité rétablie', icon: '❓', cause: '999', desc: '46', result: '50', fin: '00', rem: false,
}

// ── B) Remorquage — FIN 02, RESULT toujours 73 ───────────────────────────────
// Ordre = fréquence réelle décroissante. Couverture mesurée : 80,8 % des REM.
export const PRESETS_REM: ClosePreset[] = [
  { key: 'moteur_panne',   label: 'Moteur : ne démarre plus / tourne mal',       icon: '🔧', cause: '355', desc: '39', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, // 17,2 %
  { key: 'accident',       label: 'Accident → remorquage',                       icon: '💥', cause: '118', desc: '42', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, // 15,6 %
  { key: 'crevaison_rem',  label: 'Crevaison, réparation impossible',            icon: '🛞', cause: '246', desc: '14', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, // 13,7 %
  { key: 'moteur_casse',   label: 'Moteur cassé / HS',                           icon: '💀', cause: '355', desc: '10', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, // 10,8 %
  { key: 'moteur_surch',   label: 'Moteur en surchauffe',                        icon: '🌡️', cause: '355', desc: '22', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  4,3 %
  { key: 'embrayage',      label: 'Embrayage',                                   icon: '⚙️', cause: '704', desc: '10', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  3,9 %
  { key: 'alternateur',    label: 'Alternateur / plus de charge',                icon: '🔋', cause: '150', desc: '10', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  3,3 %
  { key: 'boite_vitesses', label: 'Boîte de vitesses',                           icon: '🕹️', cause: '722', desc: '10', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  2,3 %
  { key: 'moteur_bloque',  label: 'Moteur bloqué / calé',                        icon: '🚫', cause: '355', desc: '25', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  1,3 %
  { key: 'demarreur',      label: 'Démarreur défaillant',                        icon: '🔌', cause: '427', desc: '10', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  1,1 %
  { key: 'carburant_err',  label: 'Erreur de carburant (mauvais plein)',         icon: '⛽', cause: '515', desc: '23', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  0,8 %
  { key: 'veh_dangereux',  label: 'Véhicule dangereux / non roulant',            icon: '⚠️', cause: '999', desc: '38', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  0,7 %
  { key: 'freins_bloques', label: 'Freins bloqués',                              icon: '🛑', cause: '206', desc: '25', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  0,7 %
  { key: 'courroie_dist',  label: 'Courroie de distribution cassée',             icon: '🔗', cause: '377', desc: '10', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  0,6 %
  { key: 'turbo',          label: 'Turbo',                                       icon: '🌀', cause: '379', desc: '10', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  0,6 %
  { key: 'batt_hs',        label: 'Batterie HS (ne tient plus)',                 icon: '🪫', cause: '400', desc: '29', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true }, //  0,2 %
]

// Catch-all : le chauffeur ne sait pas trancher → remorquage générique.
// TOUJOURS présenté EN DERNIER.
export const PRESET_REM_CATCHALL: ClosePreset = {
  key: 'rem_autre', label: 'Autre panne → remorquage', icon: '❓', cause: '999', desc: '46', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true,
}

/** Toutes les options de dépannage sur place (spécifiques + catch-all EN DERNIER). */
export const ALL_DSP_PRESETS: ClosePreset[] = [...PRESETS_DSP, PRESET_DSP_CATCHALL]

/** Toutes les options de remorquage (spécifiques + catch-all EN DERNIER). */
export const ALL_REM_PRESETS: ClosePreset[] = [...PRESETS_REM, PRESET_REM_CATCHALL]

/** Un preset est-il le catch-all « Autre » de sa branche ? (mise en avant UI) */
export const isCatchAllPreset = (p: ClosePreset) => p.key === 'dsp_autre' || p.key === 'rem_autre'

/** Variante « + VR » d'un preset remorquage : mêmes codes, FIN '02' → '03'. */
export function withVr(p: ClosePreset): ClosePreset {
  if (!p.rem) return p
  return { ...p, key: `${p.key}_vr`, label: `${p.label} + VR`, fin: '03' }
}

/** Retrouve un preset par sa clé (spécifique, catch-all, ou variante +VR). */
export function findPreset(key: string): ClosePreset | undefined {
  const base = key.replace(/_vr$/, '')
  const found = [...ALL_DSP_PRESETS, ...ALL_REM_PRESETS].find(p => p.key === base)
  if (!found) return undefined
  return key.endsWith('_vr') ? withVr(found) : found
}
