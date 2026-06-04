// src/app/api/admin/parc/zones/route.ts
//
// POST /api/admin/parc/zones
// Cree une nouvelle zone de parc (parc_zones). Admin/superadmin uniquement.
// Olivier 2026-06-04.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface Body {
  key:             string
  label?:          string
  depot_id?:       string | null
  is_pool?:        boolean
  pool_capacity?:  number | null
  slot_direction?: 'ltr' | 'rtl'
  row_layout?:     'horizontal' | 'vertical'
  strict_capacity?: boolean
  driver_allowed?: boolean
  sort_order?:     number
}

async function ensureAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const ok = ['admin', 'superadmin'].some(r => roles.includes(r) || user.role === r)
  return ok ? user : null
}

export async function POST(req: Request) {
  const user = await ensureAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Body
  const key = String(body.key || '').trim()
  if (!key) return NextResponse.json({ error: 'key requise' }, { status: 400 })
  if (key.length > 20) return NextResponse.json({ error: 'key trop longue (max 20)' }, { status: 400 })

  const sb = createAdminClient()

  // Verifie unicite
  const { data: existing } = await sb
    .from('parc_zones')
    .select('key')
    .eq('key', key)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: `Zone "${key}" existe deja` }, { status: 409 })
  }

  // Calcule sort_order par defaut : max + 10 si non fourni
  let sortOrder = body.sort_order
  if (sortOrder == null) {
    const { data: maxRow } = await sb
      .from('parc_zones')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    sortOrder = (maxRow?.sort_order || 100) + 10
  }

  const payload: Record<string, any> = {
    key,
    label:           body.label?.trim() || key,
    active:          true,
    sort_order:      sortOrder,
    slot_direction:  body.slot_direction === 'rtl' ? 'rtl' : 'ltr',
    row_layout:      body.row_layout === 'vertical' ? 'vertical' : 'horizontal',
    strict_capacity: body.strict_capacity === true,
    is_pool:         body.is_pool === true,
    pool_capacity:   body.pool_capacity ?? null,
    driver_allowed:  body.driver_allowed === true,
    // Position par defaut sur le plan : coin haut-gauche (admin drag pour positionner)
    pos_x:           5,
    pos_y:           5,
    width:           15,
    height:          10,
  }

  if (body.depot_id && /^[0-9a-f-]{36}$/i.test(body.depot_id)) {
    payload.depot_id = body.depot_id
  }

  const { data: created, error } = await sb
    .from('parc_zones')
    .insert(payload)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ zone: created })
}
