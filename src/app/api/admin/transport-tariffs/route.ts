// src/app/api/admin/transport-tariffs/route.ts
//
// Grille transport / rapatriement : prix/km HTVA par source × gabarit.
// Olivier 21/09/2026 (grille par gabarit, préalable robot transports).
//
// GET  /api/admin/transport-tariffs
//        → { tariffs: [...], sources: [{ key, label }] }   (sources = catalogue actif)
// POST /api/admin/transport-tariffs
//        { source_key, vehicle_category, price_per_km_htva: number | null, active?: boolean, notes?: string }
//        prix null/vide → la ligne est SUPPRIMÉE (case vide = pas de tarif) ;
//        sinon upsert (source_key, vehicle_category).
// Accès : admin / superadmin (sessionAccess). Lecture no-store.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { listSourceCatalog } from '@/lib/missions/source-catalog'
import { listTransportTariffs, invalidateTransportTariffs } from '@/lib/tarifs/transport-tariffs'
import { isTransportGabarit } from '@/lib/tarifs/transport-gabarits'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  const access  = sessionAccess(session)   // rôles par défaut : admin / superadmin
  if (!session) return { error: 'Unauthorized', status: 401 } as const
  if (!access.ok)  return { error: 'Accès admin requis', status: 403 } as const
  return { userId: access.id } as const
}

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    invalidateTransportTariffs()   // l'écran admin veut toujours la vérité base, pas le cache 60 s
    const [tariffs, catalog] = await Promise.all([listTransportTariffs(), listSourceCatalog()])
    const sources = catalog.filter(s => s.active).map(s => ({ key: s.key, label: s.label }))
    return NextResponse.json({ ok: true, tariffs, sources }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const sourceKey = String(body?.source_key || '').toLowerCase().trim()
  const category  = String(body?.vehicle_category || '').toLowerCase().trim()
  if (!sourceKey) return NextResponse.json({ error: 'source_key requis' }, { status: 400 })
  if (!isTransportGabarit(category)) return NextResponse.json({ error: 'gabarit invalide (voiture, monospace, l1h1, l2h2)' }, { status: 400 })

  // La source doit exister au catalogue (zéro clé inventée à la main).
  const known = (await listSourceCatalog()).some(s => s.key.toLowerCase() === sourceKey)
  if (!known) return NextResponse.json({ error: `source inconnue du catalogue : ${sourceKey}` }, { status: 400 })

  const sb = createAdminClient()
  const raw = body?.price_per_km_htva
  const empty = raw == null || raw === ''
  const price = empty ? null : Number(String(raw).replace(',', '.'))
  if (!empty && (!Number.isFinite(price) || (price as number) < 0)) {
    return NextResponse.json({ error: 'prix/km invalide' }, { status: 400 })
  }

  if (price == null) {
    const { error } = await sb.from('transport_tariffs').delete().eq('source_key', sourceKey).eq('vehicle_category', category)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const row: Record<string, unknown> = {
      source_key: sourceKey, vehicle_category: category,
      price_per_km_htva: Math.round((price as number) * 10000) / 10000,
      active: body?.active === false ? false : true,
      updated_at: new Date().toISOString(),
      created_by: auth.userId,
    }
    if (typeof body?.notes === 'string') row.notes = body.notes.trim() || null
    const { error } = await sb.from('transport_tariffs').upsert(row, { onConflict: 'source_key,vehicle_category' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  invalidateTransportTariffs()
  const tariffs = await listTransportTariffs()
  return NextResponse.json({ ok: true, tariffs }, { headers: { 'Cache-Control': 'no-store' } })
}
