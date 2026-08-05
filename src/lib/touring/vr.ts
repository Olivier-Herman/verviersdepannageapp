// src/lib/touring/vr.ts
//
// Drapeaux « véhicule de remplacement / taxi / shuttle » exposés par COMEX
// (rest/Mission/detail/get). On les STOCKE tels quels, on n'en DÉDUIT rien.
//
// ─────────────────────────────────────────────────────────────────────────────
// Pourquoi plus aucune interprétation — mesuré le 05/08/2026 sur les 38 missions
// Touring en base, après qu'Olivier a repéré un bandeau « droit ouvert » sur un
// dossier qui n'était même pas couvert :
//
//   • FL_VR_PROACTIVE = 10 sur les 38 missions, sans exception. Ce n'est donc pas
//     un drapeau « offert d'office » mais une constante — le badge « proactif »
//     s'affichait partout.
//   • Les 7 dossiers dont LIB_PROD = "VEHICULE PAS COUVERT" portaient les CINQ
//     drapeaux à 9, la valeur qu'on lisait comme « proposable ». Un véhicule non
//     couvert aurait donc eu droit à tout : la lecture était inversée.
//   • Les vrais contrats (ANWB, Toyota SARA, Renault Assistance, Volvo, Arval)
//     sont à 0-0-9-9-0, pas à 9-9-9-9-9.
//   • VR_NOM et COMM_VR sont vides sur les 38 : aucun véhicule de remplacement
//     n'a jamais été réellement attribué sur ces dossiers.
//
// Conclusion : 9 ne veut pas dire « droit ouvert ». La sémantique réelle reste
// inconnue et n'a jamais été confirmée par Touring (le TODO d'origine le disait
// déjà). Les droits contractuels vivent dans **Prestex** (FDDS / fdds_arc.asp) —
// c'est de là qu'il faudra les lire, pas d'ici.
//
// Ne pas réintroduire de fonction « interpretVr » sans une confirmation écrite
// de Touring sur la signification de 0 / 9 / 10.
// ─────────────────────────────────────────────────────────────────────────────
//
// Pur (aucun import serveur) → utilisable côté serveur (map) et client.

export interface VrRights {
  vr:         number
  vr_taxi:    number
  shuttle_vr: number
  shuttle:    number
  taxi:       number
  proactive:  number
}

/** Extrait les drapeaux VR bruts depuis le détail COMEX (rest/Mission/detail/get). */
export function mapComexVr(d: Record<string, any>): VrRights {
  const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
  return {
    vr:         n(d.FL_DEMANDE_VR),
    vr_taxi:    n(d.FL_DEMANDE_VR_TAXI),
    shuttle_vr: n(d.FL_DEMANDE_SHUTTLE_VR),
    shuttle:    n(d.FL_DEMANDE_SHUTTLE),
    taxi:       n(d.FL_DEMANDE_TAXI),
    proactive:  n(d.FL_VR_PROACTIVE),
  }
}
