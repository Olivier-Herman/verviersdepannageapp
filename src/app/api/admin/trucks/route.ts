// GET  /api/admin/trucks            : liste tous les trucks (admin)
// POST /api/admin/trucks            : creer un truck
// PATCH /api/admin/trucks?id=X      : update un truck
// DELETE /api/admin/trucks?id=X     : delete (soft : active=false)
//
// Olivier 2026-06-01. Reserve admin/superadmin.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function requireAdmin(session: any): boolean {
  const role: string = session?.user?.role || ''
  return ['admin', 'superadmin'].includes(role)
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('trucks')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ trucks: data })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name  = (body.name  || '').trim()
  const plate = (body.plate || '').replace(/[-.\s]/g, '').toUpperCase().trim()
  if (!name)  return NextResponse.json({ error: 'name requis' }, { status: 400 })
  if (!plate) return NextResponse.json({ error: 'plate requise' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb.from('trucks').insert({
    name,
    plate,
    brand:      body.brand || null,
    model:      body.model || null,
    year:       body.year != null ? Number(body.year) : null,
    active:     body.active !== false,
    sort_order: body.sort_order != null ? Number(body.sort_order) : 100,
    notes:      body.notes || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ truck: data })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.name  !== undefined) patch.name  = String(body.name).trim()
  if (body.plate !== undefined) patch.plate = String(body.plate).replace(/[-.\s]/g, '').toUpperCase().trim()
  if (body.brand !== undefined) patch.brand = body.brand || null
  if (body.model !== undefined) patch.model = body.model || null
  if (body.year  !== undefined) patch.year  = body.year != null ? Number(body.year) : null
  if (body.active !== undefined)      patch.active = !!body.active
  if (body.sort_order !== undefined)  patch.sort_order = Number(body.sort_order) || 100
  if (body.notes !== undefined) patch.notes = body.notes || null

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: 'Aucun champ a mettre a jour' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data, error } = await sb.from('trucks').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ truck: data })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()
  // Soft delete : on garde la trace pour les missions/PV historiques. Le truck
  // disparait juste de la liste active des selecteurs.
  const { data, error } = await sb.from('trucks').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ truck: data, soft_deleted: true })
}
