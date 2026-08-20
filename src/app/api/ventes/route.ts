// src/app/api/ventes/route.ts
//
// API PUBLIQUE — c'est elle qui alimente le site.
// GET /api/ventes  → les lots en ligne, sans aucune donnée interne.
//
// Ce qui ne sort JAMAIS d'ici : l'origine du véhicule (abandon ou rachat), la
// fiche mission liée, le prix d'achat, le prix de réserve, la plaque et le VIN.
// La colonne blanche est déclarée une seule fois, dans lib/ventes/types.
// Olivier 2026-08-20.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { PUBLIC_COLUMNS, publicBidSummary, type SaleMode, type BidStatus } from '@/lib/ventes/types'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const sb = createAdminClient()

  // 'published' = ouvert aux offres ; 'closed' = clôturé mais encore affichable
  // le temps qu'on attribue. Les brouillons, retirés et vendus ne sortent pas.
  const visibles = sp.get('include_closed') === '1' ? ['published', 'closed'] : ['published']

  const { data: sales, error } = await sb
    .from('vehicle_sales')
    .select(PUBLIC_COLUMNS)
    .in('status', visibles)
    .order('closes_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (sales || []).map((s: any) => s.id)
  const byId: Record<string, { amount: number; status: BidStatus }[]> = {}
  if (ids.length) {
    const { data: bids } = await sb.from('vehicle_sale_bids')
      .select('sale_id, amount, status').in('sale_id', ids)
    for (const b of bids || []) (byId[b.sale_id] ||= []).push({ amount: Number(b.amount), status: b.status })
  }

  return NextResponse.json({
    sales: (sales || []).map((s: any) => ({
      ...s,
      offers: publicBidSummary(s.sale_mode as SaleMode, byId[s.id] || []),
    })),
  })
}
