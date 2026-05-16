// src/app/api/admin/decharges/route.ts
//
// GET  : liste TOUS les types (actifs + inactifs) pour la page admin
// POST : cree un nouveau type

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function isAdmin(session: any) {
  const role = session?.user?.role || ''
  return ['admin', 'superadmin'].includes(role)
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('discharge_types')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ types: data || [] })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const key = (body.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
  if (!key) return NextResponse.json({ error: 'key requise' }, { status: 400 })
  if (!body.label || !body.title || !body.body) {
    return NextResponse.json({ error: 'label, title et body sont requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('discharge_types')
    .insert({
      key,
      label:            body.label,
      title:            body.title,
      body:             body.body,
      footnote:         body.footnote || null,
      name_field_label: body.name_field_label || null,
      color:            body.color === 'green' ? 'green' : 'red',
      needs_comment:    !!body.needs_comment,
      comment_label:    body.comment_label || null,
      needs_photos:     !!body.needs_photos,
      photos_hint:      body.photos_hint || null,
      needs_schema:     !!body.needs_schema,
      active:           body.active !== false,
      sort_order:       typeof body.sort_order === 'number' ? body.sort_order : 999,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ type: data })
}
