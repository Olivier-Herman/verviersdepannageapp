// Parc par défaut d'une source de mission, défini dans
// Administration → Sources de mission (mission_source_catalog.default_parc_zone_key).
//
// Source de vérité unique pour la zone de mise en parc : utilisé par la mise en
// parc chauffeur (driver-action) et la création de mission police (police/draft).
// Olivier 2026-06-22 : « catalog strict » — le parc par défaut du catalog pilote
// la zone, sans logique codée en dur.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase'

export async function getDefaultParcZone(
  source: string | null | undefined,
  sb?: SupabaseClient,
): Promise<string | null> {
  if (!source) return null
  const client = sb || createAdminClient()
  const { data } = await client
    .from('mission_source_catalog')
    .select('default_parc_zone_key')
    .eq('key', source)
    .maybeSingle()
  return (data?.default_parc_zone_key as string) || null
}
