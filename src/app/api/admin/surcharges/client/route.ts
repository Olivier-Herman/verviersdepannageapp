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

// POST → ajoute un client { odoo_partner_id, label, kind } (assistance par defaut)
// Lookup mission_sources pour recuperer la source key liee au partner si existante,
// sinon derive la cle depuis le label normalise.
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json() as {
    odoo_partner_id?: number
    label?:           string
    kind?:            string
  }
  const odoo_partner_id = body.odoo_partner_id ? Number(body.odoo_partner_id) : null
  const label = (body.label || '').trim()
  const kind  = body.kind === 'assistance' || body.kind === 'hors_assistance' ? body.kind : 'assistance'
  if (!label || !odoo_partner_id) {
    return NextResponse.json({ error: 'odoo_partner_id et label requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Lookup mission_sources : si le partner_id est deja mappe a une source, on la reutilise
  const { data: ms } = await sb
    .from('mission_sources')
    .select('source, label')
    .eq('odoo_partner_id', odoo_partner_id)
    .maybeSingle()

  let key = ms?.source
    ? ms.source.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    : label.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  if (!key) {
    return NextResponse.json({ error: 'Cle derivee invalide' }, { status: 400 })
  }

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

  // Auto-creation mission_sources si pas deja la (pour que les futures missions
  // de ce partner soient automatiquement mappees a la bonne source)
  if (!ms) {
    await sb.from('mission_sources').upsert(
      { odoo_partner_id, source: key, label },
      { onConflict: 'odoo_partner_id' }
    )
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
