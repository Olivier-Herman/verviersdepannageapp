// CRUD admin pour les zones de police.
// Pattern identique a police_saisie_motifs. Reserve admin/superadmin.
// Olivier 2026-06-02.

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
    .from('police_zones')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ zones: data })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = (body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name requis' }, { status: 400 })

  const sb = createAdminClient()
  // Si is_default=true, on retire d abord le defaut precedent (1 seule zone par defaut)
  if (body.is_default) {
    await sb.from('police_zones').update({ is_default: false }).eq('is_default', true)
  }
  const { data, error } = await sb.from('police_zones').insert({
    name,
    sort_order: body.sort_order != null ? Number(body.sort_order) : 100,
    is_default: !!body.is_default,
    active:     body.active !== false,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ zone: data })
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
  if (body.name       !== undefined) patch.name       = String(body.name).trim()
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 100
  if (body.is_default !== undefined) patch.is_default = !!body.is_default
  if (body.active     !== undefined) patch.active     = !!body.active
  if (Object.keys(patch).length <= 1) return NextResponse.json({ error: 'Aucun champ' }, { status: 400 })

  const sb = createAdminClient()
  // Si on bascule is_default=true, retirer le defaut precedent
  if (patch.is_default === true) {
    await sb.from('police_zones').update({ is_default: false }).eq('is_default', true).neq('id', id)
  }
  const { data, error } = await sb.from('police_zones').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ zone: data })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const sb = createAdminClient()
  // Soft delete (active=false) pour preserver l historique
  const { data, error } = await sb.from('police_zones').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ zone: data })
}
