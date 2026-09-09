// Grille de restitution fourrière lue dans source_tariff_lines (lot A, 09/09/2026).
//   SERV-PEC  → forfait (prix, code Odoo entre parenthèses dans le nom : « (PECMG) »)
//   SERV-PARC → €/jour et minimum de jours (default_qty)
// Repli = valeurs qui étaient codées (restitution-grid-data.ts). Cache 60 s.
import { createAdminClient } from '@/lib/supabase'
import { RESTITUTION_FALLBACK, type RestitutionGrid } from './restitution-grid-data'

const TTL_MS = 60_000
const cache = new Map<string, { at: number; grid: RestitutionGrid }>()

export async function getRestitutionGrid(source: string): Promise<RestitutionGrid | null> {
  const src = String(source || '').toLowerCase()
  const fallback = RESTITUTION_FALLBACK[src]
  const hit = cache.get(src)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.grid
  try {
    const sb = createAdminClient()
    const { data } = await sb.from('source_tariff_lines').select('kind, name, default_qty, default_price, effective_to, position')
      .eq('source', src).eq('mission_type', 'remorquage').order('position')
    const live = (data || []).filter((l: any) => !l.effective_to || new Date(l.effective_to).getTime() > Date.now())
    const pec = live.find((l: any) => l.kind === 'SERV-PEC' && Number(l.default_price) > 0)
    const parc = live.find((l: any) => l.kind === 'SERV-PARC' && Number(l.default_price) > 0)
    if (pec) {
      const code = String(pec.name || '').match(/\(([A-Z0-9_-]{3,})\)\s*$/)?.[1] || fallback?.forfaitOdooCode || 'PEC'
      const grid: RestitutionGrid = {
        source: src,
        label: fallback?.label || src,
        forfaitHtva: Number(pec.default_price),
        forfaitOdooCode: code,
        forfaitLabel: String(pec.name || '').replace(/\s*\([A-Z0-9_-]+\)\s*$/, '') || fallback?.forfaitLabel || 'Forfait enlèvement',
        minDays: parc && parc.default_qty != null ? Number(parc.default_qty) : (fallback?.minDays || 0),
        parcDayHtva: parc ? Number(parc.default_price) : (fallback?.parcDayHtva || 20),
        fromCatalog: true,
      }
      cache.set(src, { at: Date.now(), grid })
      return grid
    }
  } catch { /* repli */ }
  return fallback || null
}
