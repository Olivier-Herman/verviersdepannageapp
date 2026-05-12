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

// POST → ajoute un client a partir d'une source existante dans les missions
// Body : { source: string, label?: string }
// La cle = source normalisee. Le label = celui fourni ou derive de mission_sources.
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json() as {
    source?: string
    label?:  string
    kind?:   string
  }
  const sourceRaw = (body.source || '').trim()
  const labelIn   = (body.label  || '').trim()
  const kind      = body.kind === 'assistance' || body.kind === 'hors_assistance' ? body.kind : 'assistance'

  if (!sourceRaw) {
    return NextResponse.json({ error: 'source requise' }, { status: 400 })
  }

  const key = sourceRaw.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  if (!key) return NextResponse.json({ error: 'Cle derivee invalide' }, { status: 400 })

  const sb = createAdminClient()

  // Recupere label et odoo_partner_id depuis mission_sources si dispo
  const { data: ms } = await sb
    .from('mission_sources')
    .select('label, odoo_partner_id')
    .eq('source', sourceRaw)
    .maybeSingle()

  const label = labelIn || ms?.label || sourceRaw.charAt(0).toUpperCase() + sourceRaw.slice(1).toLowerCase()
  const odoo_partner_id = ms?.odoo_partner_id || null

  const { data, error } = await sb
    .from('surcharge_clients')
    .insert({ key, label, kind, odoo_partner_id, active: true })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Ce client est deja dans la liste.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

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
