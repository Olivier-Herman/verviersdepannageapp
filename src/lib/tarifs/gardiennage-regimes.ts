// Tarifs journaliers de gardiennage par régime, lus dans source_tariff_lines
// (source « gardiennage », lignes SERV-PARC, classe voiture). Lot B « sans
// valeurs en dur » : les libellés d'écran (« Siabis — 20 € TVAC/jour »,
// « 3 premiers jours inclus ») se construisent d'ici, plus dans le code.
import { createAdminClient } from '@/lib/supabase'

import type { GardiennageRegime } from './gardiennage-regime-label'
export { gardiennageRegimeLabel, type GardiennageRegime } from './gardiennage-regime-label'
let cache: { at: number; rows: GardiennageRegime[] } | null = null

export async function getGardiennageRegimes(): Promise<GardiennageRegime[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rows
  const sb = createAdminClient()
  const { data, error } = await sb.from('source_tariff_lines').select('mission_type, name, default_price, free_days, effective_to')
    .eq('source', 'gardiennage').eq('kind', 'SERV-PARC')
  if (error) throw new Error(`Tarifs gardiennage illisibles : ${error.message}`)
  const rows: GardiennageRegime[] = []
  for (const l of data || []) {
    if ((l as any).effective_to && new Date((l as any).effective_to).getTime() < Date.now()) continue
    if (/cyclo|moto|2 roues/i.test(String((l as any).name || ''))) continue   // classe voiture pour l'affichage
    const p = Number((l as any).default_price || 0)
    rows.push({ regime: String((l as any).mission_type), price_htva: p, price_tvac: Math.round(p * 121) / 100, free_days: Number((l as any).free_days || 0) })
  }
  cache = { at: Date.now(), rows }
  return rows
}
