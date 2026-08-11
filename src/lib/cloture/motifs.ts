// src/lib/cloture/motifs.ts
//
// Catalogue des MOTIFS de clôture, à DEUX branches (Olivier 2026-08-11) :
//   • mobilite   → le véhicule repart (DSP confirmé, ou REM finalement réparé)
//   • remorquage → le véhicule part sur le plateau
//
// Le chauffeur ne voit QUE des motifs lisibles ; les codes vivent ici. Les deux
// branches sont ÉTANCHES : depuis une clôture « dépannage réussi », aucun motif
// de remorquage n'est atteignable (et inversement). L'issue choisie sur la page
// Action fixe la branche, le sélecteur ne reçoit que celle-là.
//
// Source des codes Touring : `close-presets.ts`, refondu le 2026-08-11 sur les
// USAGES RÉELS (6479 dossiers BKO) — cf [[project_touring_codes_audit]]. On ne
// duplique pas : ce module habille les presets existants.
//
// La colonne VAB est prévue mais volontairement vide : le référentiel des 351
// codes Panne se capture en lecture seule le jour où on branche VAB. Un motif
// sans mapping VAB retombera sur le catch-all « Divers / Autre problème ».

import {
  ALL_DSP_PRESETS, ALL_REM_PRESETS, isCatchAllPreset, type ClosePreset,
} from '@/lib/touring/close-presets'
import type { Branch } from './outcomes'

/** Codes VAB (Comet) — Solution imposée par la branche, Panne portée par le motif. */
export interface VabCodes {
  /** `wtBreakdownCodeLevel1` au format `parent|enfant`. */
  panne1: string
  /** `wtBreakdownCodeLevel2` (souvent auto-rempli par Comet après le niveau 1). */
  panne2?: string
}

export interface Motif {
  key:    string
  label:  string
  icon:   string
  branch: Branch
  /** true = catch-all « Autre » → TOUJOURS présenté en dernier. */
  catchAll: boolean
  touring: { cause: string; desc: string; result: string }
  vab?:    VabCodes
}

/** Solution VAB imposée par la branche (niveau 1 + niveau 2). */
export const VAB_SOLUTION: Record<Branch, { solution1: string; solution2: string }> = {
  mobilite:   { solution1: '12900|13917', solution2: '13918' },  // Mobilité rétablie — Problème résolu → Voir Varia
  remorquage: { solution1: '814|13938',   solution2: '13939' },  // Pas résolue — Remorquage → Par technicien
}

/** Panne VAB de repli quand le motif n'a pas encore son équivalent capturé. */
export const VAB_PANNE_FALLBACK: VabCodes = { panne1: '4004|4066', panne2: '4591' }  // Divers — Autre problème

/** Équivalences VAB connues (capturées en live). Le reste se complétera au build VAB. */
const VAB_BY_KEY: Record<string, VabCodes> = {
  batt_boost:  { panne1: '4006|4075', panne2: '4627' },   // Batterie 12V — Déchargée
  cosses_batt: { panne1: '4006|4075', panne2: '4627' },
  batt_hs:     { panne1: '4006|4075', panne2: '4627' },
  crevaison_roue:  { panne1: '4042|4495', panne2: '6166' },   // Roues/Pneus — Fuite importante
  crevaison_rem:   { panne1: '4042|4495', panne2: '6165' },   // Roues/Pneus — Endommagé
  accident:        { panne1: '4032|4382', panne2: '5777' },   // Self-inflicted — Accident
  dsp_autre:   VAB_PANNE_FALLBACK,
  rem_autre:   VAB_PANNE_FALLBACK,
}

function toMotif(p: ClosePreset, branch: Branch): Motif {
  return {
    key: p.key, label: p.label, icon: p.icon, branch,
    catchAll: isCatchAllPreset(p),
    touring: { cause: p.cause, desc: p.desc, result: p.result },
    vab: VAB_BY_KEY[p.key],
  }
}

/** Catalogue complet, catch-all déjà en dernier dans chaque branche. */
export const MOTIFS: Record<Branch, Motif[]> = {
  mobilite:   ALL_DSP_PRESETS.map(p => toMotif(p, 'mobilite')),
  remorquage: ALL_REM_PRESETS.map(p => toMotif(p, 'remorquage')),
}

/** Motifs d'une branche — jamais mélangés (étanchéité des deux branches). */
export function motifsForBranch(branch: Branch): Motif[] {
  return MOTIFS[branch] || []
}

/** Retrouve un motif DANS SA BRANCHE (un motif d'une autre branche est refusé). */
export function findMotif(branch: Branch, key: string): Motif | undefined {
  return motifsForBranch(branch).find(m => m.key === key)
}

/** Le catch-all « Autre » de la branche (toujours présent). */
export function catchAllOf(branch: Branch): Motif {
  const list = motifsForBranch(branch)
  return list.find(m => m.catchAll) || list[list.length - 1]
}

/** Codes VAB d'un motif (Solution = branche, Panne = motif, repli si non mappé). */
export function vabCodesFor(motif: Motif): { solution1: string; solution2: string } & VabCodes {
  return { ...VAB_SOLUTION[motif.branch], ...(motif.vab || VAB_PANNE_FALLBACK) }
}

/**
 * Repli SANS IA : priorise les motifs par mots-clés de la description de panne.
 * Sert quand l'appel Claude échoue ou dépasse son délai — la liste reste utilisable
 * et à peu près bien triée. Renvoie des CLÉS de la branche demandée uniquement.
 */
const KEYWORDS: { re: RegExp; keys: string[] }[] = [
  { re: /batter|démarr|demarr|booster|plat\b|ne démarre|voyant/i, keys: ['batt_boost', 'cosses_batt', 'batt_hs', 'alternateur', 'demarreur', 'voyant_elec'] },
  { re: /pneu|crevai|roue|jante|éclat|eclat/i,                    keys: ['crevaison_roue', 'crevaison_rem'] },
  { re: /clé|cle\b|clef|enferm|serrure|portière|portiere/i,       keys: ['cles_habitacle', 'serrure_bloquee'] },
  { re: /accident|choc|collision|carross|tôle|tole/i,             keys: ['accident'] },
  { re: /moteur|fumée|fumee|surchauff|température|temperature/i,  keys: ['moteur_panne', 'moteur_casse', 'moteur_surch', 'moteur_repart', 'surchauffe_ok'] },
  { re: /carburant|essence|diesel|panne sèche|panne seche|plein/i, keys: ['panne_seche', 'carburant_err'] },
  { re: /embray|boîte|boite|vitesse/i,                            keys: ['embrayage', 'boite_vitesses'] },
  { re: /frein/i,                                                 keys: ['freins_debloq', 'freins_bloques'] },
  { re: /courroie|distribution/i,                                 keys: ['courroie_dist'] },
  { re: /turbo/i,                                                 keys: ['turbo'] },
  { re: /embourb|fossé|fosse|talus|neige|boue/i,                  keys: ['embourbe'] },
  { re: /refroidiss|liquide|radiateur|durit/i,                    keys: ['refroidissement'] },
  { re: /huile/i,                                                 keys: ['huile_moteur'] },
]

export function suggestByKeywords(branch: Branch, description: string | null | undefined, limit = 6): string[] {
  const list = motifsForBranch(branch).filter(m => !m.catchAll)
  const text = String(description || '')
  const hits: string[] = []
  for (const k of KEYWORDS) {
    if (!k.re.test(text)) continue
    for (const key of k.keys) if (list.some(m => m.key === key) && !hits.includes(key)) hits.push(key)
  }
  // Complète avec l'ordre du catalogue (déjà trié par fréquence réelle).
  for (const m of list) { if (hits.length >= limit) break; if (!hits.includes(m.key)) hits.push(m.key) }
  return hits.slice(0, limit)
}
