// src/lib/ventes/admin-data.ts
//
// Données de l'écran « Ventes de véhicules » (lots + compteurs d'offres +
// vivier des abandons) — partagées entre /admin/ventes et l'onglet Ventes de
// l'écran Sorties (refonte Fourrière, temps 3, 16/09/2026).

export interface VentesAdminData { sales: any[]; abandons: any[] }

export async function loadVentesAdminData(sb: any): Promise<VentesAdminData> {
  const { data: sales } = await sb.from('vehicle_sales').select('*').order('created_at', { ascending: false })
  const ids = (sales || []).map((s: any) => s.id)
  const counts: Record<string, { total: number; confirmed: number; best: number | null }> = {}
  if (ids.length) {
    const { data: bids } = await sb.from('vehicle_sale_bids').select('sale_id, amount, status').in('sale_id', ids)
    for (const b of bids || []) {
      const c = counts[b.sale_id] || (counts[b.sale_id] = { total: 0, confirmed: 0, best: null })
      c.total++
      if (b.status === 'confirmed' || b.status === 'awarded') { c.confirmed++; c.best = c.best == null ? Number(b.amount) : Math.max(c.best, Number(b.amount)) }
    }
  }
  // Fiches avec un abandon enregistré, pas encore en vente (vivier « Depuis un abandon »).
  const { data: abandons } = await sb.from('incoming_missions')
    .select('id, mission_number, source, vehicle_brand, vehicle_model, vehicle_plate, abandon_at')
    .not('abandon_at', 'is', null).neq('source', 'police_saisie').order('abandon_at', { ascending: false }).limit(50)
  const dejaEnVente = new Set((sales || []).map((s: any) => s.mission_id).filter(Boolean))
  return {
    sales: (sales || []).map((s: any) => ({ ...s, bids: counts[s.id] || { total: 0, confirmed: 0, best: null } })),
    abandons: (abandons || []).filter((a: any) => !dejaEnVente.has(a.id)),
  }
}
