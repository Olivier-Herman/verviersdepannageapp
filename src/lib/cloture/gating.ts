// src/lib/cloture/gating.ts
//
// Garde du FLUX 2 (clôture unifiée « Action »). Olivier 2026-08-11.
//
// Rollout à DEUX axes — il faut les deux pour voir le nouveau flux :
//   1. QUI       : le chauffeur est-il testeur ? (constante ci-dessous)
//   2. ASSISTANCE: le flag `flux2_<assistance>` est-il ouvert ? (table feature_flags)
//
// Tant qu'un des deux dit non, le chauffeur garde l'écran actuel, INTACT. Aucun
// code de l'ancien flux n'est supprimé : le flux 2 est purement additif.
//
// Franck est raccordé depuis le 2026-08-11 (feu vert Olivier). Pour ouvrir à
// tous les chauffeurs sur une assistance : passer son flag à 'all' depuis /admin.
// Pour refermer : remettre le flag à 'off' — aucun redéploiement dans les deux sens.

import { getFlagMode } from '@/lib/feature-flags'

/** Chauffeurs testeurs du flux 2 (en plus des superadmins, toujours autorisés). */
export const FLUX2_TESTER_IDS: string[] = [
  'de9a37aa-41b5-4a56-894b-cc304f601d1a',   // Franck — testeur du flux 2 (Olivier 2026-08-11)
]

export interface Flux2Actor { id?: string | null; role?: string | null; roles?: string[] | null }

/** Axe QUI : superadmin (toujours) ou testeur déclaré. */
export function isFlux2Tester(actor: Flux2Actor | null | undefined): boolean {
  if (!actor) return false
  const roles = [actor.role, ...(actor.roles || [])].filter(Boolean) as string[]
  if (roles.includes('superadmin')) return true
  return !!actor.id && FLUX2_TESTER_IDS.includes(actor.id)
}

/**
 * Assistance d'une mission, du point de vue du flux 2. On se base sur le LIEN
 * technique (`source_format='comex'`) et pas sur `source` : une mission Touring
 * autoroute reclassée en Siabis garde son dossier COMEX mais perd sa source —
 * c'est exactement le bug de gating corrigé le 2026-07-09.
 */
export type Flux2Assistance = 'touring' | 'vab' | 'kaze' | null

export function flux2AssistanceOf(mission: { source?: string | null; source_format?: string | null } | null | undefined): Flux2Assistance {
  if (!mission) return null
  if (mission.source_format === 'comex') return 'touring'
  if (mission.source === 'vab')          return 'vab'
  if (mission.source === 'kaze')         return 'kaze'
  return null
}

/** Axe ASSISTANCE : le flag de cette assistance autorise-t-il cet utilisateur ? */
export async function flux2AssistanceOpen(assistance: Flux2Assistance, actor: Flux2Actor | null | undefined): Promise<boolean> {
  if (!assistance) return false
  const mode = await getFlagMode(`flux2_${assistance}`)
  if (mode === 'all') return true
  if (mode === 'superadmin') return isFlux2Tester(actor)
  return false
}

/**
 * Réponse unique à « ce chauffeur, sur cette mission, voit-il le flux 2 ? ».
 * À appeler côté SERVEUR (lecture de feature_flags via service_role).
 */
export async function flux2Enabled(
  actor: Flux2Actor | null | undefined,
  mission: { source?: string | null; source_format?: string | null } | null | undefined,
): Promise<boolean> {
  const assistance = flux2AssistanceOf(mission)
  if (!assistance) return false
  if (!isFlux2Tester(actor)) {
    // Mode 'all' = ouvert à tous les chauffeurs pour cette assistance.
    return (await getFlagMode(`flux2_${assistance}`)) === 'all'
  }
  return flux2AssistanceOpen(assistance, actor)
}
