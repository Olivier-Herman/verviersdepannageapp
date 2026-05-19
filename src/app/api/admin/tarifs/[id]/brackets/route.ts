// src/app/api/admin/tarifs/[id]/brackets/route.ts
//
// GET /api/admin/tarifs/[id]/brackets
// Retourne les tranches tarifaires (source_tariff_brackets) pour un
// source_tariff donne (mode pricing_mode='brackets').
//
// Acces : superadmin uniquement (comme le reste de /admin/tarifs).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  if (role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès superadmin requis' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: tariff, error: tErr } = await sb
    .from('source_tariffs')
    .select('id, source, mission_type, pricing_mode')
    .eq('id', params.id)
    .single()

  if (tErr || !tariff) {
    return NextResponse.json({ error: 'Tarif introuvable' }, { status: 404 })
  }

  if (tariff.pricing_mode !== 'brackets') {
    return NextResponse.json({ brackets: [], note: 'Ce tarif n est pas en mode brackets.' })
  }

  const { data: brackets, error: bErr } = await sb
    .from('source_tariff_brackets')
    .select('id, from_km, to_km, price_normal, price_majore, effective_from, effective_to')
    .eq('source', tariff.source)
    .eq('mission_type', tariff.mission_type)
    .order('from_km', { ascending: true })

  if (bErr) {
    return NextResponse.json({ error: bErr.message }, { status: 500 })
  }

  return NextResponse.json({ brackets: brackets || [] })
}
