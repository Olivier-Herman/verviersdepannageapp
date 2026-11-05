// Bouton Chauffeur / Dispatch (Olivier 05/11/2026) : « à partir du moment où il se met en chauffeur, c'est qu'il est
// pas dispatch, donc quelqu'un d'autre assure le dispatch ». Seuls l'affichage et les alertes changent, jamais les droits.
import { createAdminClient } from '@/lib/supabase'
import { isPreviewOn } from '@/lib/feature-flags'
import type { WorkMode } from '@/lib/work-mode-view'

const FLAG = 'work_mode_switch'
const ROLES_BUREAU = ['dispatcher', 'admin', 'superadmin']

/** Le bouton existe-t-il pour cette personne ? Les deux casquettes + préversion. */
export async function workModeAvailable(u: any): Promise<boolean> {
  if (!u?.id) return false
  const roles: string[] = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])].filter(Boolean)
  const bureau = roles.some(r => ROLES_BUREAU.includes(r))
  const chauffeur = roles.includes('driver') || (Array.isArray(u.modules) && u.modules.includes('driver_missions'))
  return bureau && chauffeur && isPreviewOn(FLAG, u.role, u.id)
}

export async function readWorkMode(u: any): Promise<{ available: boolean; mode: WorkMode }> {
  if (!(await workModeAvailable(u))) return { available: false, mode: 'dispatch' }
  const { data } = await createAdminClient().from('users').select('work_mode').eq('id', u.id).maybeSingle()
  return { available: true, mode: (data as any)?.work_mode === 'chauffeur' ? 'chauffeur' : 'dispatch' }
}

/** Retire de la liste ceux qui sont en mode Chauffeur. En cas d'erreur, tout le monde reste : mieux vaut une alerte de trop qu'une alerte perdue. */
export async function retirerModeChauffeur(ids: string[]): Promise<string[]> {
  if (!ids.length) return ids
  try {
    const { data, error } = await createAdminClient().from('users').select('id, role').in('id', ids).eq('work_mode', 'chauffeur')
    if (error || !data?.length) return ids
    const exclus = new Set<string>()
    for (const u of data as any[]) if (await isPreviewOn(FLAG, u.role, u.id)) exclus.add(u.id)
    return ids.filter(id => !exclus.has(id))
  } catch { return ids }
}
