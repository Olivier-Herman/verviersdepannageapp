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
// Sources NON eligibles a la REL :
//   - police_mg (Mal Garee) : client paye direct ou perd le vehicule
//   - police_rodeo            : idem
//   - police_saisie           : pas de relivraison
//   - police_avp              : pas de relivraison
//   - police_snc en scenario  : 'dsp' (pas de remorquage) OU 'rem_client'
//                               (REM direct chez le client, pas de step parc)
//
// Olivier 2026-05-28 (clarification finale) : la conversion REM -> REM+REL
// se declenche des qu une adresse de relivraison est connue (destination ou
// redelivery_address) ET que la source est eligible. Plus de distinction
// auto/manuel par source : c est l adresse qui sert de signal de validation
// (l adresse est saisie => le client/assistance est confirme).
//
// Le bouton "Gerer la mise en parc" sert donc principalement a saisir
// l adresse de relivraison quand elle n existe pas encore (cas Accident /
// SNC / Prive ou l adresse est definie apres paiement / reprise assistance).

const POLICE_NON_RELIVRABLES = new Set([
  'police_mg',
  'police_rodeo',
  'police_saisie',
  'police_avp',
])

/** Eligibilite REL : la source autorise-t-elle une relivraison ? */
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
