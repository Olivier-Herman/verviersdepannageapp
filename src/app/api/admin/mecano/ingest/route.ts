// src/app/api/admin/mecano/ingest/route.ts
//
// Ingestion « La tête à Matthieu » : télécharge + mirroir les fiches Touring
// d'une marque. Superadmin. POST { brand, limit? } — rappeler jusqu'à mirrored=0.
// GET → état (nb de fiches par marque).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { ingestBrand }       from '@/lib/mecano/ingest'

export const dynamic     = 'force-dynamic'
export const maxDuration  = 120

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const brand = String(body.brand || '').trim()
  if (!brand) return NextResponse.json({ error: 'brand requis' }, { status: 400 })
  try {
    const res = await ingestBrand(brand, { limit: Math.min(Number(body.limit) || 40, 80) })
    return NextResponse.json({ ok: true, ...res })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'échec ingestion' }, { status: 500 })
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if ((session?.user as any)?.role !== 'superadmin') return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })
  const sb = createAdminClient()
  const { data } = await sb.from('mecano_docs').select('brand, section')
  const byBrand: Record<string, { patrouilleur: number; remorquage: number }> = {}
  for (const d of (data || []) as any[]) {
    byBrand[d.brand] ||= { patrouilleur: 0, remorquage: 0 }
    if (d.section === 'remorquage') byBrand[d.brand].remorquage++
    else byBrand[d.brand].patrouilleur++
  }
  return NextResponse.json({ total: (data || []).length, brands: byBrand })
}
