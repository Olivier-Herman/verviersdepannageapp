// src/app/api/admin/decharges/[id]/route.ts
//
// PATCH  : modifie un type existant
// DELETE : supprime un type (hard delete - les decharges deja signees gardent
//          le snapshot via type_key qui pointe vers une cle qui n existe plus
//          → le PDF utilisera le texte stocke dans entry.motif ou fallback
//          generique. Recommande : desactiver (active=false) plutot que delete.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function isAdmin(session: any) {
  const role = session?.user?.role || ''
  return ['admin', 'superadmin'].includes(role)
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const patch: any = { updated_at: new Date().toISOString() }
  // Ne mappe que les champs presents (PATCH partiel)
  if (body.label !== undefined)            patch.label = body.label
  if (body.title !== undefined)            patch.title = body.title
  if (body.body !== undefined)             patch.body = body.body
  if (body.footnote !== undefined)         patch.footnote = body.footnote || null
  if (body.name_field_label !== undefined) patch.name_field_label = body.name_field_label || null
  if (body.color !== undefined)            patch.color = body.color === 'green' ? 'green' : 'red'
  if (body.needs_comment !== undefined)    patch.needs_comment = !!body.needs_comment
  if (body.comment_label !== undefined)    patch.comment_label = body.comment_label || null
  if (body.needs_photos !== undefined)     patch.needs_photos = !!body.needs_photos
  if (body.photos_hint !== undefined)      patch.photos_hint = body.photos_hint || null
  if (body.needs_schema !== undefined)     patch.needs_schema = !!body.needs_schema
  if (body.active !== undefined)           patch.active = !!body.active
  if (body.sort_order !== undefined)       patch.sort_order = body.sort_order

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('discharge_types')
    .update(patch)
    .eq('id', params.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ type: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { error } = await sb.from('discharge_types').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
