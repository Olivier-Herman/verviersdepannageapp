// src/app/api/parc/block/batch/route.ts
//
// POST /api/parc/block/batch
// Body: { to_block: [{zone_key, row_number, slot_index}], to_unblock: [...], reason? }
//
// Flow gestionnaire fourriere : clic Bloquer -> motif unique -> selection
// multiple -> valider. On envoie :
//   - to_block   : slots a bloquer (avec le meme reason)
//   - to_unblock : slots a debloquer (qu on aurait cliques alors qu ils
//                  etaient deja rouges)
//
// Validations :
//   - to_block : slot pas occupe par mission active, pas dans un groupe fusionne
//   - to_unblock : slot doit etre bloque
//
// Refus partiel : si l un des slots viole une regle, on rejette TOUT le batch
// (pour eviter un etat intermediaire confus).
//
// Permissions : admin/superadmin ou module 'fourriere'.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PARKED_STATUSES = ['parked', 'delivering']

interface SlotRef {
  zone_key:   string
  row_number: number
  slot_index: number
}

function parseSlots(raw: any): SlotRef[] {
  if (!Array.isArray(raw)) return []
  const out: SlotRef[] = []
  for (const s of raw) {
    const zone = String(s?.zone_key || '').trim()
    const row  = Number(s?.row_number)
    const slot = Number(s?.slot_index)
    if (!zone || !Number.isInteger(row) || row <= 0 || !Number.isInteger(slot) || slot <= 0) continue
    out.push({ zone_key: zone, row_number: row, slot_index: slot })
  }
  return out
}

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
  const toBlock   = parseSlots(body.to_block)
  const toUnblock = parseSlots(body.to_unblock)
  const reason    = body.reason != null ? String(body.reason).trim().slice(0, 200) || null : null

  if (toBlock.length === 0 && toUnblock.length === 0) {
    return NextResponse.json({ error: 'Aucun emplacement sélectionné.' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Validation to_block : refuse si occupe par mission active ou dans un groupe fusionne
  if (toBlock.length > 0) {
    const orMissions = toBlock.map(s =>
      `and(parc_zone_key.eq.${s.zone_key},parc_row_number.eq.${s.row_number},parc_slot_index.eq.${s.slot_index})`
    ).join(',')
    const { data: occupied } = await sb
      .from('incoming_missions')
      .select('vehicle_plate, parc_zone_key, parc_row_number, parc_slot_index')
      .in('status', PARKED_STATUSES)
      .or(orMissions)
    if (occupied && occupied.length > 0) {
      const labels = occupied.map(o => `${o.parc_zone_key}${o.parc_row_number}-${o.parc_slot_index} (${o.vehicle_plate || '?'})`).join(', ')
      return NextResponse.json({ error: `Slot(s) occupé(s) : ${labels}. Retire les véhicules avant de bloquer.` }, { status: 409 })
    }

    const orGroups = toBlock.map(s =>
      `and(zone_key.eq.${s.zone_key},row_number.eq.${s.row_number},slot_index.eq.${s.slot_index})`
    ).join(',')
    const { data: inGroup } = await sb
      .from('parc_slot_groups')
      .select('zone_key, row_number, slot_index')
      .or(orGroups)
    if (inGroup && inGroup.length > 0) {
      const labels = inGroup.map(g => `${g.zone_key}${g.row_number}-${g.slot_index}`).join(', ')
      return NextResponse.json({ error: `Slot(s) fusionné(s) : ${labels}. Défusionne d'abord ou exclus-les.` }, { status: 409 })
    }
  }

  // 1) INSERT to_block (ON CONFLICT DO NOTHING via upsert sur la cle UNIQUE)
  let blocked = 0
  if (toBlock.length > 0) {
    const rows = toBlock.map(s => ({
      zone_key:        s.zone_key,
      row_number:      s.row_number,
      slot_index:      s.slot_index,
      reason,
      blocked_by_user: user.id || null,
    }))
    const { error } = await sb
      .from('parc_blocked_slots')
      .upsert(rows, { onConflict: 'zone_key,row_number,slot_index' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    blocked = rows.length
  }

  // 2) DELETE to_unblock
  let unblocked = 0
  if (toUnblock.length > 0) {
    // Supabase ne supporte pas un OR composite tres long dans .delete() :
    // on supprime slot par slot en batch parallele (max 4 par UX).
    const results = await Promise.all(toUnblock.map(s =>
      sb.from('parc_blocked_slots').delete({ count: 'exact' })
        .ilike('zone_key',   s.zone_key)  // case-insensitive (cf bug BOX/Box)
        .eq('row_number', s.row_number)
        .eq('slot_index', s.slot_index)
    ))
    for (const r of results) {
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
      unblocked += r.count ?? 0
    }
  }

  return NextResponse.json({ ok: true, blocked, unblocked })
}
