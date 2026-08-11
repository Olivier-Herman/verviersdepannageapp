// src/lib/cloture/gating.ts
//
// Garde du FLUX 2 (clôture unifiée « Action »). Olivier 2026-08-11.
//
// UN SEUL mécanisme : la grille CHAUFFEUR × ASSISTANCE (table `flux2_activation`,
// pilotée depuis /admin/flux2). Une case cochée = flux 2 actif pour ce couple, et
// pour lui seul : ouvrir Tayson sur Touring n'ouvre pas VAB pour autant.
//
// Superadmins : toujours vrai, pour pouvoir vérifier sans se cocher partout.
//
// Le gate précédent (liste de testeurs en dur + flags `flux2_<assistance>`) est
// remplacé — deux mécanismes de déploiement en parallèle, c'est la garantie qu'un
// jour l'un contredit l'autre.

import { createAdminClient } from '@/lib/supabase'

export interface Flux2Actor { id?: string | null; role?: string | null; roles?: string[] | null }

/** Cache court : la grille change rarement, la clôture la lit à chaque écran. */
let cache: { at: number; set: Set<string> } | null = null
const TTL_MS = 30_000

async function loadGrid(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.set
  const sb = createAdminClient()
  const { data } = await sb.from('flux2_activation').select('driver_id, assistance_key, enabled')
  const set = new Set<string>()
  for (const r of (data || []) as any[]) if (r.enabled) set.add(`${r.driver_id}|${r.assistance_key}`)
  cache = { at: Date.now(), set }
  return set
}

export function invalidateFlux2Cache() { cache = null }

const isSuperadmin = (a: Flux2Actor | null | undefined) =>
  !!a && [a.role, ...(a.roles || [])].filter(Boolean).includes('superadmin')

/**
 * Assistance d'une mission = la clé du catalogue des sources. Touring se
 * reconnaît AUSSI au lien COMEX : une mission autoroute reclassée en Siabis garde
 * son dossier COMEX mais perd sa source — c'est le bug de gating du 2026-07-09.
 */
export function flux2AssistanceOf(
  mission: { source?: string | null; source_format?: string | null } | null | undefined,
): string | null {
  if (!mission) return null
  if (mission.source_format === 'comex') return 'touring'
  return mission.source || null
}

/** Le flux 2 est-il ouvert pour ce chauffeur sur cette assistance ? */
export async function isFlux2Enabled(driverId: string | null | undefined, assistanceKey: string | null | undefined): Promise<boolean> {
  if (!driverId || !assistanceKey) return false
  try { return (await loadGrid()).has(`${driverId}|${assistanceKey}`) } catch { return false }
}

/**
 * Réponse unique à « cette personne, sur cette mission, voit-elle le flux 2 ? ».
 * On regarde le CHAUFFEUR ASSIGNÉ (c'est lui qui clôture) ; à défaut, la personne
 * connectée. À appeler côté SERVEUR (lecture via service_role).
 */
export async function flux2Enabled(
  actor: Flux2Actor | null | undefined,
  mission: { source?: string | null; source_format?: string | null; assigned_to?: string | null } | null | undefined,
): Promise<boolean> {
  const assistance = flux2AssistanceOf(mission)
  if (!assistance) return false
  if (isSuperadmin(actor)) return true
  const driverId = (mission as any)?.assigned_to || actor?.id || null
  return isFlux2Enabled(driverId, assistance)
}
