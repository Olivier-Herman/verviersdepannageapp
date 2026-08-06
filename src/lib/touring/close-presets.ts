// src/lib/touring/close-presets.ts
//
// Presets de clôture CHAUFFEUR Touring COMEX. Le chauffeur choisit une panne
// courante ; on envoie à COMEX un triplet de codes « juste valides » (le dispatch
// affine ensuite sur la jambe remorquage qui revient dans VD Soft). Olivier 2026-08-06.
//
// Codes issus du référentiel COMEX (widgets detailPanneCodeSelect / DescSelect /
// ResultSelect / detailInfosEndMission ; dump 2026-08-06).
//
// RÈGLES :
//   • REM ou REM+VR ⟹ COD_PANNE_RESULT = '73' (Réparation sur route impossible), TOUJOURS.
//   • FIN : 00 = dépannage sur place · 02 = + remorquage · 03 = + rem + VR.
//   • La variante +VR d'un preset REM = même codes, FIN passe de '02' à '03' (withVr()).
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
 * 2026-08-06 (widget detailInfosEndMission). Une mission n'expose qu'un
 * sous-ensemble via `LST_CODE_END_MIS` (dynamique) → filtrer avec ça à l'affichage.
 */
export const END_MISSION_LABELS: Record<string, string> = {
  '00': 'Fin de tâche',
  '02': 'Fin de tâche, + Remorquage',
  '03': 'Fin de tâche, + Rem + VR',
  '04': 'Fin de tâche, + VR',
  '06': 'Fin dépannage téléphonique',
  '07': 'Fin de REM transformé en DEP',
  '33': 'Fin dép. tél. + VR',
  '34': 'Fin de tâche + Rem + Taxi',
  '35': 'Fin de tâche + Rem + VR + Taxi',
  '36': 'Refus garage',
  '20': 'Annul. Sté partie avec déplacement',
  '21': 'Annul. Refus POU avec déplacement',
  '23': 'Annul. Sté partie sans déplacement',
  '24': 'Annul. Refus POU sans déplacement',
  '25': 'Annul. envoyer quelqu’un d’autre',
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

// ── A) Dépannage sur place — FIN 00 ──────────────────────────────────────────
export const PRESETS_DSP: ClosePreset[] = [
  { key: 'batt_recharge',   label: 'Batterie déchargée → rechargée',            icon: '🔋', cause: '400', desc: '29', result: '58', fin: '00', rem: false },
  { key: 'batt_boost',      label: 'Batterie à plat → aide au démarrage',       icon: '⚡', cause: '400', desc: '29', result: '59', fin: '00', rem: false },
  { key: 'crevaison_roue',  label: 'Crevaison → roue de secours montée',        icon: '🛞', cause: '246', desc: '14', result: '61', fin: '00', rem: false },
  { key: 'pneu_regonfle',   label: 'Pneu dégonflé → regonflé',                  icon: '💨', cause: '247', desc: '24', result: '57', fin: '00', rem: false },
  { key: 'cles_habitacle',  label: 'Clés enfermées → ouverture',                icon: '🔑', cause: '680', desc: '45', result: '60', fin: '00', rem: false },
  { key: 'serrure_bloquee', label: 'Serrure / portière bloquée → ouverte',      icon: '🚪', cause: '661', desc: '25', result: '60', fin: '00', rem: false },
  { key: 'panne_seche',     label: 'Panne sèche → ravitaillement',              icon: '⛽', cause: '515', desc: '17', result: '50', fin: '00', rem: false },
  { key: 'cosses_batt',     label: 'Cosses batterie desserrées → remises',      icon: '🔌', cause: '403', desc: '27', result: '57', fin: '00', rem: false },
  { key: 'antivol_bloque',  label: 'Antivol de direction bloqué → débloqué',    icon: '🔒', cause: '239', desc: '25', result: '55', fin: '00', rem: false },
]

// ── B) Remorquage — FIN 02, RESULT toujours 73 ───────────────────────────────
export const PRESETS_REM: ClosePreset[] = [
  { key: 'moteur',        label: 'Problème moteur (surchauffe) → remorquage',       icon: '🌡️', cause: '355', desc: '22', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true },
  { key: 'boite_embray',  label: 'Boîte de vitesses / embrayage → remorquage',      icon: '⚙️', cause: '704', desc: '25', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true },
  { key: 'crevaison_rem', label: 'Crevaison, réparation impossible → remorquage',   icon: '🛞', cause: '259', desc: '14', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true },
  { key: 'demarreur',     label: 'Démarreur défaillant → remorquage',              icon: '🔌', cause: '427', desc: '10', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true },
  { key: 'batt_hs',       label: 'Batterie HS (ne tient plus) → remorquage',       icon: '🔋', cause: '400', desc: '26', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true },
  { key: 'accident',      label: 'Accident → remorquage',                          icon: '💥', cause: '144', desc: '42', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true },
  { key: 'carburant_err', label: 'Erreur de carburant (mauvais plein) → remorquage', icon: '⛽', cause: '515', desc: '41', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true },
  { key: 'courroie_dist', label: 'Courroie de distribution cassée → remorquage',   icon: '🔗', cause: '377', desc: '10', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true },
  { key: 'fouine_durit',  label: 'Tuyau percé par une fouine → remorquage',        icon: '🦫', cause: '313', desc: '73', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true },
]

// Catch-all : le chauffeur ne sait pas trancher → remorquage générique.
export const PRESET_REM_CATCHALL: ClosePreset = {
  key: 'rem_autre', label: 'Autre panne → remorquage', icon: '❓', cause: '999', desc: '46', result: RESULT_REM_IMPOSSIBLE, fin: '02', rem: true,
}

/** Toutes les options de remorquage (spécifiques + catch-all). */
export const ALL_REM_PRESETS: ClosePreset[] = [...PRESETS_REM, PRESET_REM_CATCHALL]

/** Variante « + VR » d'un preset remorquage : mêmes codes, FIN '02' → '03'. */
export function withVr(p: ClosePreset): ClosePreset {
  if (!p.rem) return p
  return { ...p, key: `${p.key}_vr`, label: `${p.label} + VR`, fin: '03' }
}

/** Retrouve un preset par sa clé (spécifique, catch-all, ou variante +VR). */
export function findPreset(key: string): ClosePreset | undefined {
  const base = key.replace(/_vr$/, '')
  const found = [...PRESETS_DSP, ...ALL_REM_PRESETS].find(p => p.key === base)
  if (!found) return undefined
  return key.endsWith('_vr') ? withVr(found) : found
}
