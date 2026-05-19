// src/app/api/parc/place/route.ts
//
// POST /api/parc/place
// Body: { mission_id, zone_key?, row_number?, slot_index? }
//   - Si zone_key/row_number/slot_index sont fournis -> place le vehicule
//   - Si zone_key=null -> retire le vehicule du parc (revient en "a placer")
//
// Permissions :
//   - admin / superadmin / dispatcher : peuvent placer dans toutes les zones
//   - chauffeur (driver)              : limite a A et Transit (cf. memoire equipe)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const DRIVER_ALLOWED_ZONES = ['A', 'Transit']

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user  = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const normalized = roles.map(r => String(r ?? '').toLowerCase())
  const isSuperadmin = normalized.includes('superadmin')
  const isDispatcher = isSuperadmin || normalized.some(r => r === 'admin' || r === 'dispatcher')
  const isDriver     = isSuperadmin || normalized.includes('chauffeur') || normalized.includes('driver')

  if (!isDriver && !isDispatcher) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const missionId = String(body.mission_id || '')
  const zoneKey   = body.zone_key != null ? String(body.zone_key).trim() : null
  const rowNumber = body.row_number != null ? Number(body.row_number) : null
  const slotIndex = body.slot_index != null ? Number(body.slot_index) : null

  if (!missionId) {
    return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Validation des coordonnees si placement (zoneKey != null)
  if (zoneKey) {
    if (!Number.isInteger(rowNumber) || rowNumber == null || rowNumber <= 0 ||
        !Number.isInteger(slotIndex) || slotIndex == null || slotIndex <= 0) {
      return NextResponse.json({ error: 'row_number et slot_index requis si zone_key' }, { status: 400 })
    }

    // Permission chauffeur restreinte aux zones autorisees
    if (!isDispatcher && isDriver && !DRIVER_ALLOWED_ZONES.includes(zoneKey)) {
      return NextResponse.json({
        error: `Les chauffeurs ne peuvent placer que dans ${DRIVER_ALLOWED_ZONES.join(' ou ')}`,
      }, { status: 403 })
    }

    // Verifier que la ligne existe
    const { data: row } = await sb
      .from('parc_rows')
      .select('id, capacity')
      .eq('zone_key', zoneKey)
      .eq('row_number', rowNumber)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({ error: `Ligne ${zoneKey}${rowNumber} inexistante` }, { status: 400 })
    }

    // Si la zone est strict_capacity, refuse l overflow
    const { data: zone } = await sb
      .from('parc_zones')
      .select('strict_capacity')
      .eq('key', zoneKey)
      .maybeSingle()
    if (zone?.strict_capacity && slotIndex > row.capacity) {
      return NextResponse.json({
        error: `Zone ${zoneKey} en mode strict : capacite ${row.capacity}, pas d overflow.`,
      }, { status: 409 })
    }

    // Refuse si le slot est marque bloque par un gestionnaire fourriere
    const { data: blocked } = await sb
      .from('parc_blocked_slots')
      .select('reason')
      .eq('zone_key',   zoneKey)
      .eq('row_number', rowNumber)
      .eq('slot_index', slotIndex)
      .maybeSingle()
    if (blocked) {
      const motif = blocked.reason ? ` (${blocked.reason})` : ''
      return NextResponse.json({
        error: `Emplacement ${zoneKey}${rowNumber}-${slotIndex} bloqué${motif}.`,
      }, { status: 409 })
    }

    // Si un autre vehicule occupe deja exactement ce slot, on l'echange
    // (swap) : il prend la position precedente du vehicule deplace.
    const { data: currentOccupant } = await sb
      .from('incoming_missions')
      .select('id, parc_zone_key, parc_row_number, parc_slot_index')
      .eq('parc_zone_key', zoneKey)
      .eq('parc_row_number', rowNumber)
      .eq('parc_slot_index', slotIndex)
      .neq('id', missionId)
      .maybeSingle()

    if (currentOccupant) {
      // Recuperer l'ancienne position du vehicule qu'on deplace
      const { data: moving } = await sb
        .from('incoming_missions')
        .select('parc_zone_key, parc_row_number, parc_slot_index')
        .eq('id', missionId)
        .maybeSingle()

      // Swap : l'occupant prend l'ancienne position (ou null si nouveau placement)
      await sb.from('incoming_missions').update({
        parc_zone_key:   moving?.parc_zone_key || null,
        parc_row_number: moving?.parc_row_number || null,
        parc_slot_index: moving?.parc_slot_index || null,
      }).eq('id', currentOccupant.id)
    }
  }

  const { error } = await sb.from('incoming_missions').update({
    parc_zone_key:   zoneKey,
    parc_row_number: zoneKey ? rowNumber : null,
    parc_slot_index: zoneKey ? slotIndex : null,
  }).eq('id', missionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
