// src/lib/missions/judicial.ts
//
// Saisie JUDICIAIRE : appel police saisie dont le motif est « Saisie Judiciaire »
// (police_saisie_motifs.code = 'SAISIE_JUDICIAIRE'). À signaler très visiblement
// (fiche en rouge + « ⚠ ATTENTION Judiciaire ») côté dispatch ET fourrière.

export function isJudicialSaisie(m: {
  source?: string | null
  saisie_motif_code?: string | null
} | null | undefined): boolean {
  return !!m && m.source === 'police_saisie' && m.saisie_motif_code === 'SAISIE_JUDICIAIRE'
}
