// Grille transport / rapatriement : prix/km HTVA par SOURCE × GABARIT, lue
// dans transport_tariffs (migration 202609211230). Côté serveur uniquement.
// Olivier 21/09/2026 (grille par gabarit, préalable robot transports).
//
//   const p = await getTransportPricePerKm('touring', 'l2h2')   // 1.25 | null
//
// Cache 60 s (comme le catalogue des sources) ; invalidé par l'API admin à
// chaque écriture. Le gabarit « autre » n'est jamais dans la grille : son
// prix/km vit sur la fiche (incoming_missions.transport_price_per_km_htva).
import { createAdminClient } from '@/lib/supabase'
import { isTransportGabarit, type TransportGabarit } from './transport-gabarits'

export interface TransportTariffRow {
  id:                string
  source_key:        string
  vehicle_category:  TransportGabarit
  price_per_km_htva: number
  active:            boolean
  notes:             string | null
  updated_at:        string | null
}

const TTL_MS = 60_000
let cache: { at: number; rows: TransportTariffRow[] } | null = null

/** Toutes les lignes de la grille (actives ou non), triées source puis gabarit. */
export async function listTransportTariffs(): Promise<TransportTariffRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows
  const sb = createAdminClient()
  const { data, error } = await sb.from('transport_tariffs')
    .select('id, source_key, vehicle_category, price_per_km_htva, active, notes, updated_at')
    .order('source_key').order('vehicle_category')
  if (error) throw new Error(`Grille transport illisible : ${error.message}`)
  const rows: TransportTariffRow[] = (data || [])
    .filter((r: any) => isTransportGabarit(r.vehicle_category))
    .map((r: any) => ({
      id: String(r.id), source_key: String(r.source_key).toLowerCase(), vehicle_category: r.vehicle_category,
      price_per_km_htva: Number(r.price_per_km_htva), active: r.active !== false, notes: r.notes ?? null, updated_at: r.updated_at ?? null,
    }))
  cache = { at: Date.now(), rows }
  return rows
}
export function invalidateTransportTariffs() { cache = null }

/** Prix/km HTVA ACTIF pour une source × gabarit, ou null s'il n'est pas configuré. */
export async function getTransportPricePerKm(source: string | null | undefined, category: string | null | undefined): Promise<number | null> {
  if (!source || !isTransportGabarit(category)) return null
  const k = String(source).toLowerCase().trim()
  const row = (await listTransportTariffs()).find(r => r.active && r.source_key === k && r.vehicle_category === category)
  return row && row.price_per_km_htva >= 0 ? row.price_per_km_htva : null
}

/** Sources qui ont au moins un prix/km actif (pour les écrans qui listent « qui envoie des transports »). */
export async function transportSources(): Promise<string[]> {
  return Array.from(new Set((await listTransportTariffs()).filter(r => r.active).map(r => r.source_key)))
}
