// src/app/api/parc/block/route.ts
//
// POST /api/parc/block
// Body: { zone_key, row_number, slot_index, reason? }
//
// Toggle un emplacement bloque :
//   - si la combinaison existe deja  -> DELETE (= debloque)
//   - sinon                          -> INSERT (= bloque)
// Renvoie { blocked: boolean } pour que l UI sache l etat resultant.
//
// Permissions : admin / superadmin / users avec module 'fourriere'.
// Les chauffeurs ne peuvent pas bloquer.
//
// Refus : on ne peut pas bloquer un slot deja occupe par un vehicule
// (il faut le retirer du parc d abord).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const normalized = roles.map(r => String(r ?? '').toLowerCase())
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isSuperadmin = normalized.includes('superadmin')
  const isAdmin      = isSuperadmin || normalized.includes('admin')
  const hasFourriere = modules.includes('fourriere')

  if (!isAdmin && !hasFourriere) {
    return NextResponse.json({ error: 'Accès réservé aux gestionnaires fourrière.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const zoneKey   = body.zone_key != null ? String(body.zone_key).trim() : ''
  const rowNumber = body.row_number != null ? Number(body.row_number) : NaN
  const slotIndex = body.slot_index != null ? Number(body.slot_index) : NaN
  const reason    = body.reason != null ? String(body.reason).trim().slice(0, 200) || null : null

  if (!zoneKey || !Number.isInteger(rowNumber) || rowNumber <= 0 ||
      !Number.isInteger(slotIndex) || slotIndex <= 0) {
    return NextResponse.json({ error: 'zone_key, row_number et slot_index requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // 1) Refuse si le slot est deja occupe par un vehicule actif
  const { data: occupant } = await sb
    .from('incoming_missions')
    .select('id, vehicle_plate')
    .eq('parc_zone_key', zoneKey)
    .eq('parc_row_number', rowNumber)
    .eq('parc_slot_index', slotIndex)
    .in('status', ['parked', 'delivering'])
    .maybeSingle()

  if (occupant) {
    return NextResponse.json({
      error: `Slot occupé par ${occupant.vehicle_plate || 'un véhicule'}. Retire-le du parc avant de bloquer.`,
    }, { status: 409 })
  }

  // 2) Toggle : existe -> delete, sinon -> insert
  const { data: existing } = await sb
    .from('parc_blocked_slots')
    .select('id')
    .eq('zone_key',   zoneKey)
    .eq('row_number', rowNumber)
    .eq('slot_index', slotIndex)
    .maybeSingle()

  if (existing) {
    const { error } = await sb.from('parc_blocked_slots').delete().eq('id', existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, blocked: false })
  }

  const { error } = await sb.from('parc_blocked_slots').insert({
    zone_key:        zoneKey,
    row_number:      rowNumber,
    slot_index:      slotIndex,
    reason:          reason,
    blocked_by_user: user.id || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, blocked: true })
}
