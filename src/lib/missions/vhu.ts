// src/lib/missions/vhu.ts
// Source VHU « Car Parts & Recycling » : transport interne, jamais facturé,
// auto-validé (pas d'étape « Valider ») → onglet dispatch dédié « VHU ».
// Olivier 2026-07-15.
export const VHU_SOURCE = 'garage_j7772c'
export const isVhuSource = (source: string | null | undefined) => source === VHU_SOURCE
