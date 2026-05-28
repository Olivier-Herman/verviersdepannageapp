// src/lib/missions/rel-eligible.ts
//
// Helper : determine si une mission de REM peut etre convertie en REM+REL
// quand le vehicule est mis en parc. Une mission REM+REL devient elligible
// a la creation d une mission de relivraison (REL) plus tard.
//
// Olivier 2026-05-28 :
//   "Un REM = Remorquage direct
//    Un REM+REL = Remorquage via parc, sur laquelle on peut creer une mission
//    REL (Assistance, SNC si paye ou pris en charge, Accident, Siabis Couvert)"
//
// Sources NON eligibles :
//   - police_mg (Mal Garee) : le client paye direct ou perd le vehicule
//   - police_rodeo            : idem
//   - police_saisie           : pas de relivraison
//   - police_avp              : pas de relivraison
//   - prive                   : le remorquage prive ne fait pas de step parc
// SNC : eligible uniquement si snc_scenario = 'rem_client' ou 'rem_depot'
// (= cas ou il y a remorquage, donc parc puis relivraison possible).
// SC (sia_couvert) : eligible.
// Toutes les autres sources (assistance : touring, ethias, axa, etc.) : eligibles.

const POLICE_NON_RELIVRABLES = new Set([
  'police_mg',
  'police_rodeo',
  'police_saisie',
  'police_avp',
])

export function isRelEligibleSource(
  source: string | null | undefined,
  sncScenario?: string | null,
): boolean {
  if (!source) return false
  const s = source.toLowerCase().trim()
  if (s === 'prive') return false
  if (POLICE_NON_RELIVRABLES.has(s)) return false
  if (s === 'police_snc') {
    const scen = (sncScenario || '').toLowerCase()
    return scen === 'rem_client' || scen === 'rem_depot'
  }
  return true
}
