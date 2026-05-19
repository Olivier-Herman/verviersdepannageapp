// src/app/api/parc/merge/route.ts
//
// POST /api/parc/merge
// Body: { slots: [{ zone_key, row_number, slot_index }, ...] }
//
// Cree un groupe d emplacements fusionnes (2 a 4 slots). Le PREMIER
// element du tableau est le PRIMARY : il garde le label de la fusion
// (ex: H4-4 reste H4-4 meme si on lie H4-3 apres). Les missions
// posees sur n importe quel slot du groupe sont routees vers le
// primary cote /api/parc/place.
//
// Validations :
//   - 2-4 slots
//   - Tous dans une zone existante
//   - Aucun deja dans un autre groupe, deja bloque, ou occupe par une mission
//
// Permissions : admin/superadmin ou module 'fourriere'.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PARKED_STATUSES = ['parked', 'delivering']

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const normalized = roles.map(r => String(r ?? '').toLowerCase())
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isAdmin = normalized.includes('admin') || normalized.includes('superadmin')
  if (!isAdmin && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Accès réservé aux gestionnaires fourrière.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const rawSlots: any[] = Array.isArray(body.slots) ? body.slots : []
  if (rawSlots.length < 2 || rawSlots.length > 4) {
    return NextResponse.json({ error: 'Sélectionne entre 2 et 4 emplacements à fusionner.' }, { status: 400 })
  }

  // Normalisation + validation des coords
  const slots = rawSlots.map((s, i) => ({
    zone_key:        String(s.zone_key || '').trim(),
    row_number:      Number(s.row_number),
    slot_index:      Number(s.slot_index),
    selection_order: i + 1,  // ordre du tableau = ordre de selection
  }))
  for (const s of slots) {
    if (!s.zone_key || !Number.isInteger(s.row_number) || s.row_number <= 0 ||
        !Number.isInteger(s.slot_index) || s.slot_index <= 0) {
      return NextResponse.json({ error: 'Coordonnées de slot invalides.' }, { status: 400 })
    }
  }
  // Doublons internes ?
  const seen = new Set<string>()
  for (const s of slots) {
    const k = `${s.zone_key}-${s.row_number}-${s.slot_index}`
    if (seen.has(k)) {
      return NextResponse.json({ error: `Slot ${s.zone_key}${s.row_number}-${s.slot_index} sélectionné en double.` }, { status: 400 })
    }
    seen.add(k)
  }

  const sb = createAdminClient()

  // 1) Aucun slot ne doit etre dans un groupe existant
  const orFilter = slots.map(s =>
    `and(zone_key.eq.${s.zone_key},row_number.eq.${s.row_number},slot_index.eq.${s.slot_index})`
  ).join(',')

  const { data: alreadyGrouped } = await sb
    .from('parc_slot_groups')
    .select('zone_key, row_number, slot_index')
    .or(orFilter)
  if (alreadyGrouped && alreadyGrouped.length > 0) {
    const labels = alreadyGrouped.map(g => `${g.zone_key}${g.row_number}-${g.slot_index}`).join(', ')
    return NextResponse.json({ error: `Déjà fusionné(s) : ${labels}. Défusionne d'abord.` }, { status: 409 })
  }

  // 2) Aucun slot ne doit etre bloque
  const { data: alreadyBlocked } = await sb
    .from('parc_blocked_slots')
    .select('zone_key, row_number, slot_index')
    .or(orFilter)
  if (alreadyBlocked && alreadyBlocked.length > 0) {
    const labels = alreadyBlocked.map(b => `${b.zone_key}${b.row_number}-${b.slot_index}`).join(', ')
    return NextResponse.json({ error: `Emplacement(s) bloqué(s) : ${labels}. Débloque-les d'abord.` }, { status: 409 })
  }

  // 3) Aucun slot ne doit etre occupe par une mission active
  const missionOr = slots.map(s =>
    `and(parc_zone_key.eq.${s.zone_key},parc_row_number.eq.${s.row_number},parc_slot_index.eq.${s.slot_index})`
  ).join(',')
  const { data: occupied } = await sb
    .from('incoming_missions')
    .select('vehicle_plate, parc_zone_key, parc_row_number, parc_slot_index')
    .in('status', PARKED_STATUSES)
    .or(missionOr)
  if (occupied && occupied.length > 0) {
    const labels = occupied.map(o => `${o.parc_zone_key}${o.parc_row_number}-${o.parc_slot_index} (${o.vehicle_plate || '?'})`).join(', ')
    return NextResponse.json({ error: `Slot(s) occupé(s) : ${labels}. Retire-les avant de fusionner.` }, { status: 409 })
  }

  // 4) INSERT batch avec un group_uuid commun (genere cote app pour partager
  //    la meme valeur entre toutes les lignes)
  const group_uuid: string = globalThis.crypto.randomUUID()

  const rows = slots.map(s => ({
    group_uuid,
    zone_key:        s.zone_key,
    row_number:      s.row_number,
    slot_index:      s.slot_index,
    selection_order: s.selection_order,
    created_by:      user.id || null,
  }))
  const { error } = await sb.from('parc_slot_groups').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok:        true,
    group_uuid,
    primary:   slots[0],
    members:   slots.slice(1),
  })
}
