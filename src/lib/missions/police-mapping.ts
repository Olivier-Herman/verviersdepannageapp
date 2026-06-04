// src/lib/missions/police-mapping.ts
//
// Olivier 2026-06-03 (audit J-2 W10) : centralisation des mappings types
// police pour eviter le drift entre /api/towsoft/create et
// /api/missions/police/draft (qui dupliquaient les memes constantes).
//
// Si ces 2 routes ont des mappings differents, on cree des incoherences
// selon le sous-scenario (ex: Mal Garee deplacement_paye via draft vs
// chargement via towsoft/create).
//
// Cette lib est la SOURCE UNIQUE pour : zone parc, source VD Soft,
// prefix external_id.

/**
 * Mapping type police → source VD Soft pour incoming_missions.source.
 * Determine quel tarif applique estimateMissionPrice + quel mapping
 * affiche dans /dispatch et /fourriere/search.
 */
export const FOURRIERE_TYPE_TO_SOURCE: Record<string, string> = {
  mal_garee:   'police_mg',
  rodeo:       'police_rodeo',
  avp:         'police_avp',
  snc:         'police_snc',
  sc:          'sia_couvert',
  appel_prive: 'prive',
  saisie:      'police_saisie',
  accident:    'police_accident',
}

/**
 * Prefix de l external_id selon le type. Permet de retrouver/trier
 * facilement les missions par scenario dans la BDD.
 */
export const PREFIX_BY_TYPE: Record<string, string> = {
  mal_garee:   'MG',
  rodeo:       'RODEO',
  avp:         'AVP',
  snc:         'SNC',
  sc:          'SC',
  appel_prive: 'PRIVE',
  saisie:      'SAISIE',
  accident:    'ACC',
}

/**
 * Zone parc cible. Regles metier :
 *
 * - mal_garee : chargement (defaut) → zone L. deplacement_paye → null
 *   (client paie sur place avant chargement, on repart sans mise en parc).
 * - rodeo : toujours zone J (procedure saisie judiciaire).
 * - avp : toujours zone J (abandon vehicule).
 * - saisie : toujours zone J (saisie judiciaire).
 * - accident : zone Transit (TowSoft mappe vers K3 = TRANSIT APPEL POLICE
 *   ACCIDENT, on reutilise la zone Transit existante VD Soft).
 * - snc / sc : Transit si rem_depot, sinon null (intervention immediate).
 * - appel_prive : Transit si destination='depot' (REM avec mise en parc),
 *   sinon null (DSP / REM client = facturation directe).
 */
export function zoneForType(
  t: string,
  sncScenario?: string | null,
  appelPriveDestination?: string | null,
  malGareeScenario?: string | null,
): string | null {
  if (t === 'mal_garee') return malGareeScenario === 'deplacement_paye' ? null : 'L'
  if (t === 'rodeo')     return 'J'
  if (t === 'avp')       return 'J'
  if (t === 'saisie')    return 'J'
  if (t === 'accident')  return 'Transit'
  if (t === 'snc' || t === 'sc') return sncScenario === 'rem_depot' ? 'Transit' : null
  if (t === 'appel_prive') return appelPriveDestination === 'depot' ? 'Transit' : null
  return null
}

/**
 * Renvoie true si le type cree une mission fourriere (= mission VD Soft
 * avec INSERT incoming_missions). Determine si le bloc 'fourriere' du
 * flow towsoft/create / draft est traverse.
 */
export function isFourriereType(type: string): boolean {
  return Boolean(FOURRIERE_TYPE_TO_SOURCE[type])
}
