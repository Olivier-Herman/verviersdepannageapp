// src/app/api/admin/tarifs/lines/[lineId]/route.ts
//
// PATCH  /api/admin/tarifs/lines/[lineId] : update une ligne template
// DELETE /api/admin/tarifs/lines/[lineId] : supprime
//
// Acces : superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const VALID_KINDS = ['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV']

export async function PATCH(req: Request, { params }: { params: { lineId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès superadmin requis' }, { status: 403 })
  }

  const id = parseInt(params.lineId, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }

  if (body.kind != null) {
    if (!VALID_KINDS.includes(body.kind)) {
      return NextResponse.json({ error: 'kind invalide' }, { status: 400 })
    }
    patch.kind = body.kind
  }
  if (body.name != null) patch.name = String(body.name).trim()
  if (body.position != null) {
    const v = Number(body.position)
    if (Number.isFinite(v)) patch.position = v
  }
  if (body.default_qty !== undefined) {
    patch.default_qty = body.default_qty === null ? null : Number(body.default_qty)
  }
  if (body.default_price !== undefined) {
    patch.default_price = body.default_price === null ? null : Number(body.default_price)
  }
  if (body.default_price_majore !== undefined) {
    patch.default_price_majore = body.default_price_majore === null || body.default_price_majore === '' ? null : Number(body.default_price_majore)
  }
  if (body.apply_surcharges !== undefined) {
    patch.apply_surcharges = Boolean(body.apply_surcharges)
  }
  if (body.notes !== undefined) patch.notes = body.notes || null
  if (body.free_days !== undefined) {
    patch.free_days = body.free_days === null || body.free_days === '' ? 0 : Math.max(0, Math.floor(Number(body.free_days)))
  }
  if (body.parc_count_from !== undefined) {
    // Olivier 2026-06-14 : autorise aussi 'levee_saisie_date' (ligne gardiennage
    // hors période saisie) — ne plus l'écraser en 'parked_at'.
    patch.parc_count_from = ['intervention_date', 'levee_saisie_date'].includes(body.parc_count_from)
      ? body.parc_count_from : 'parked_at'
  }

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: 'Au moins un champ requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('source_tariff_lines')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ line: data })
}

export async function DELETE(_req: Request, { params }: { params: { lineId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès superadmin requis' }, { status: 403 })
  }

  const id = parseInt(params.lineId, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 })

  const sb = createAdminClient()
  const { error } = await sb.from('source_tariff_lines').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
