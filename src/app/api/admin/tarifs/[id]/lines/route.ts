// src/app/api/admin/tarifs/[id]/lines/route.ts
//
// GET /api/admin/tarifs/[id]/lines
// Retourne les lignes pre-configurees pour un source_tariff donne
// (pricing_mode='lines').
//
// Acces : superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'superadmin') {
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

  if (tariff.pricing_mode !== 'lines') {
    return NextResponse.json({ lines: [], note: 'Ce tarif n est pas en mode lines.' })
  }

  const { data: lines, error: lErr } = await sb
    .from('source_tariff_lines')
    .select('id, position, kind, name, default_qty, default_price, apply_surcharges, free_days, parc_count_from, effective_from, effective_to, notes')
    .eq('source', tariff.source)
    .eq('mission_type', tariff.mission_type)
    .order('position', { ascending: true })

  if (lErr) {
    return NextResponse.json({ error: lErr.message }, { status: 500 })
  }

  return NextResponse.json({ lines: lines || [] })
}
