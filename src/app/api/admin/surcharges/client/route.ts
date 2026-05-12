// src/app/api/admin/surcharges/client/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PROTECTED_KEYS = ['snc', 'accident_police']

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 } as const
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return { error: 'Forbidden', status: 403 } as const
  }
  return { user } as const
}

// POST → ajoute un client { key, label, kind }
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json() as { key?: string; label?: string; kind?: string }
  const key   = (body.key || '').toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  const label = (body.label || '').trim()
  const kind  = body.kind === 'assistance' || body.kind === 'hors_assistance' ? body.kind : null
  if (!key || !label || !kind) {
    return NextResponse.json({ error: 'key, label et kind requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('surcharge_clients')
    .insert({ key, label, kind, active: true })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ client: data })
}

// PATCH → update label, kind, active sur un client existant
export async function PATCH(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json() as { key?: string; label?: string; active?: boolean }
  const key = (body.key || '').toLowerCase().trim()
  if (!key) return NextResponse.json({ error: 'key requis' }, { status: 400 })

  const update: any = { updated_at: new Date().toISOString() }
  if (body.label !== undefined)  update.label  = body.label
  if (body.active !== undefined) update.active = body.active

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('surcharge_clients')
    .update(update)
    .eq('key', key)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ client: data })
}

// DELETE → supprime un client (sauf snc + accident_police)
export async function DELETE(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(req.url)
  const key = (searchParams.get('key') || '').toLowerCase().trim()
  if (!key) return NextResponse.json({ error: 'key requis' }, { status: 400 })
  if (PROTECTED_KEYS.includes(key)) {
    return NextResponse.json({ error: 'Ce client ne peut pas etre supprime' }, { status: 409 })
  }

  const sb = createAdminClient()
  const { error } = await sb.from('surcharge_clients').delete().eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
