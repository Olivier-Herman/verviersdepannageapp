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
// SNC : eligible uniquement si snc_scenario = 'rem_depot'. Olivier 2026-05-28 :
// "SNC rem_client est un REM Direct et donc pas un REM+REL" — le vehicule
// est livre directement chez le client, pas de step parc.
// SC (sia_couvert), Accident, Assistance (Touring, Ethias, AXA...) : eligibles.
// Prive : eligible aussi (Olivier 2026-05-28).

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
  if (POLICE_NON_RELIVRABLES.has(s)) return false
  if (s === 'police_snc') {
    return (sncScenario || '').toLowerCase() === 'rem_depot'
  }
  return true
}
