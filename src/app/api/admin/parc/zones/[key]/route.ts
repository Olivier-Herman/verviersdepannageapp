// src/app/api/admin/parc/zones/[key]/route.ts
//
// PATCH /api/admin/parc/zones/:key
// Body: { pos_x?, pos_y?, width?, height? }
// Met a jour la position/taille d une zone sur le plan visuel.
//
// Acces : admin / superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function ensureAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const ok = ['admin', 'superadmin'].some(r => roles.includes(r) || user.role === r)
  return ok ? user : null
}

function clampPercent(n: unknown): number | null {
  if (n == null) return null
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return Math.max(0, Math.min(100, v))
}

export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  const user = await ensureAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, any> = {}
  for (const f of ['pos_x', 'pos_y', 'width', 'height']) {
    const v = clampPercent(body[f])
    if (v != null) patch[f] = v
  }
  // slot_direction : ltr ou rtl
  if (body.slot_direction === 'ltr' || body.slot_direction === 'rtl') {
    patch.slot_direction = body.slot_direction
  }
  // row_layout : horizontal ou vertical
  if (body.row_layout === 'horizontal' || body.row_layout === 'vertical') {
    patch.row_layout = body.row_layout
  }
  // strict_capacity : refuse overflow si true
  if (typeof body.strict_capacity === 'boolean') {
    patch.strict_capacity = body.strict_capacity
  }
  // is_pool : zone "Bordel" (capacite globale sans rangees)
  if (typeof body.is_pool === 'boolean') {
    patch.is_pool = body.is_pool
  }
  // pool_capacity : nombre cible (null = illimite)
  if (body.pool_capacity === null || body.pool_capacity === '') {
    patch.pool_capacity = null
  } else if (body.pool_capacity !== undefined) {
    const v = parseInt(String(body.pool_capacity), 10)
    if (Number.isFinite(v) && v >= 0) patch.pool_capacity = v
  }
  // depot_id : rattachement de la zone a un parc (Pepinster/Verviers/...)
  // Olivier 2026-06-04 : permet d attribuer une zone a un depot via UI admin
  if (body.depot_id === null) {
    patch.depot_id = null
  } else if (typeof body.depot_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.depot_id)) {
    patch.depot_id = body.depot_id
  }
  // driver_allowed : si true, chauffeurs peuvent deposer dans cette zone
  if (typeof body.driver_allowed === 'boolean') {
    patch.driver_allowed = body.driver_allowed
  }
  // zone_type : regroupement organisationnel (relivraison / accident / saisie).
  if (body.zone_type === null || body.zone_type === '') {
    patch.zone_type = null
  } else if (['relivraison', 'accident', 'saisie'].includes(body.zone_type)) {
    patch.zone_type = body.zone_type
  }
  // active : soft-delete (false) ou reactivation (true)
  if (typeof body.active === 'boolean') {
    patch.active = body.active
  }
  // label : libelle affiche (modifiable)
  if (typeof body.label === 'string' && body.label.trim()) {
    patch.label = body.label.trim()
  }
  // sort_order : reordonner via UI
  if (Number.isFinite(body.sort_order)) {
    patch.sort_order = Number(body.sort_order)
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Au moins un champ requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('parc_zones')
    .update(patch)
    .eq('key', decodeURIComponent(params.key))
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ zone: data })
}

// DELETE = soft-delete (set active=false). La zone reste en BDD pour
// l historique des missions deja passees, mais disparait des selecteurs
// (filtres active=true par defaut cote API).
// Olivier 2026-06-04.
export async function DELETE(_req: Request, { params }: { params: { key: string } }) {
  const user = await ensureAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const zoneKey = decodeURIComponent(params.key)

  // Verifie qu aucune mission active n est encore dans cette zone (parked)
  const { count: usedBy } = await sb
    .from('incoming_missions')
    .select('id', { count: 'exact', head: true })
    .eq('parc_zone_key', zoneKey)
    .eq('status', 'parked')

  if (usedBy && usedBy > 0) {
    return NextResponse.json({
      error: `Impossible : ${usedBy} vehicule(s) encore en zone ${zoneKey}. Transferez-les d abord.`,
    }, { status: 409 })
  }

  const { data, error } = await sb
    .from('parc_zones')
    .update({ active: false })
    .eq('key', zoneKey)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ zone: data, soft_deleted: true })
}
