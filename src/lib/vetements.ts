// src/lib/vetements.ts — commande de pulls et t-shirts (module temporaire, Olivier
// 09/10/2026). Tout le personnel (chauffeurs, bureau, direction) donne sa taille de
// t-shirt et de pull : Sam le demande à l'ouverture de l'app, écran bloquant, réponse
// obligatoire le jour même. Campagne et exclus (ex. Tayson, fin de contrat) dans
// app_settings « campagne_vetements » ; tailles dans la table tailles_vetements.
import { createAdminClient } from '@/lib/supabase'

export const TAILLES = ['S', 'M', 'L', 'XL', '2XL'] as const
export const STAFF_ROLES = ['driver', 'dispatcher', 'admin', 'superadmin']
const KEY = 'campagne_vetements'

export interface Campagne { active: boolean; deadline: string | null; excluded: string[] }

export async function getCampagne(): Promise<Campagne> {
  const { data } = await createAdminClient().from('app_settings').select('value').eq('key', KEY).maybeSingle()
  let v: any = {}
  try { v = data?.value ? JSON.parse(String(data.value)) : {} } catch { v = {} }
  return { active: !!v.active, deadline: v.deadline || null, excluded: Array.isArray(v.excluded) ? v.excluded.map(String) : [] }
}

export async function saveCampagne(c: Campagne): Promise<void> {
  await createAdminClient().from('app_settings').upsert({ key: KEY, value: JSON.stringify(c) }, { onConflict: 'key' })
}

/** Personnel concerné : comptes actifs du personnel, hors exclus. */
export async function personnelConcerne(c?: Campagne) {
  const camp = c || await getCampagne()
  const { data } = await createAdminClient().from('users').select('id, name, role, roles').eq('active', true)
  return (data || [])
    .filter((u: any) => STAFF_ROLES.includes(String(u.role)) || (Array.isArray(u.roles) && u.roles.some((r: string) => STAFF_ROLES.includes(r))))
    .map((u: any) => ({ id: u.id as string, name: u.name as string, role: u.role as string, excluded: camp.excluded.includes(u.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}
