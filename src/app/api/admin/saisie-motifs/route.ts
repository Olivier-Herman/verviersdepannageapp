// CRUD admin pour les motifs de saisie Police.
// Reserve admin/superadmin.
// Olivier 2026-06-01.

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
    .from('police_saisie_motifs')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ motifs: data })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const code  = (body.code  || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  const label = (body.label || '').trim()
  if (!code)  return NextResponse.json({ error: 'code requis' }, { status: 400 })
  if (!label) return NextResponse.json({ error: 'label requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb.from('police_saisie_motifs').insert({
    code,
    label,
    label_short: body.label_short || null,
    icon:        body.icon || null,
    sort_order:  body.sort_order != null ? Number(body.sort_order) : 100,
    active:      body.active !== false,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ motif: data })
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
  if (body.code        !== undefined) patch.code        = String(body.code).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (body.label       !== undefined) patch.label       = String(body.label).trim()
  if (body.label_short !== undefined) patch.label_short = body.label_short || null
  if (body.icon        !== undefined) patch.icon        = body.icon || null
  if (body.sort_order  !== undefined) patch.sort_order  = Number(body.sort_order) || 100
  if (body.active      !== undefined) patch.active      = !!body.active
  if (Object.keys(patch).length <= 1) return NextResponse.json({ error: 'Aucun champ' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb.from('police_saisie_motifs').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ motif: data })
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
  const { data, error } = await sb.from('police_saisie_motifs').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ motif: data })
}
