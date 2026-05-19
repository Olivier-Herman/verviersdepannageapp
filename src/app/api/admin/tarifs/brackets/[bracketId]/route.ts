// src/app/api/admin/tarifs/brackets/[bracketId]/route.ts
//
// PATCH  /api/admin/tarifs/brackets/[bracketId] : update prix / range d une tranche
// DELETE /api/admin/tarifs/brackets/[bracketId] : supprime la tranche
//
// Acces : superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { bracketId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès superadmin requis' }, { status: 403 })
  }

  const id = parseInt(params.bracketId, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }

  if (body.price_normal != null) {
    const v = Number(body.price_normal)
    if (Number.isFinite(v) && v >= 0) patch.price_normal = v
  }
  if (body.price_majore != null) {
    const v = Number(body.price_majore)
    if (Number.isFinite(v) && v >= 0) patch.price_majore = v
  }
  if (body.from_km != null) {
    const v = Number(body.from_km)
    if (Number.isFinite(v) && v >= 0) patch.from_km = v
  }
  if (body.to_km != null) {
    const v = Number(body.to_km)
    if (Number.isFinite(v) && v >= 0) patch.to_km = v
  }
  if (body.effective_to !== undefined) {
    patch.effective_to = body.effective_to || null
  }

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: 'Au moins un champ requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('source_tariff_brackets')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bracket: data })
}

export async function DELETE(_req: Request, { params }: { params: { bracketId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès superadmin requis' }, { status: 403 })
  }

  const id = parseInt(params.bracketId, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 })

  const sb = createAdminClient()
  const { error } = await sb.from('source_tariff_brackets').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
