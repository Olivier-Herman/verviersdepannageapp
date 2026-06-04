// src/app/api/missions/[id]/transfer-parc/route.ts
//
// Olivier 2026-06-04 : transfert d une mission d une zone de parc vers une
// autre (eventuellement dans un autre depot). Action operateur fourriere
// uniquement. Pas de mission de deplacement creee : update direct + log.
//
// Reset parc_row_number et parc_slot_index : la nouvelle zone n a pas les
// memes rangees, donc le vehicule passe en mode "non place" jusqu a ce
// qu un operateur le repositionne via /admin/parc ou drag&drop /fourriere/plan.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface Body {
  zone_key: string
  reason?:  string  // optionnel, libre
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  // Olivier 2026-06-04 : module fourriere uniquement (admin/superadmin pas concerne)
  if (!modules.includes('fourriere') && !['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden : module fourriere requis' }, { status: 403 })
  }

  const body = await req.json() as Body
  const newZoneKey = String(body.zone_key || '').trim()
  if (!newZoneKey) return NextResponse.json({ error: 'zone_key requis' }, { status: 400 })

  const sb = createAdminClient()

  // 1. Charge mission + verifie statut
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, status, parc_zone_key, parc_row_number, parc_slot_index')
    .eq('id', params.id)
    .single()
  if (mErr || !mission) {
    return NextResponse.json({ error: `Mission introuvable : ${mErr?.message || 'unknown'}` }, { status: 404 })
  }
  if (mission.status !== 'parked') {
    return NextResponse.json({ error: `Mission pas en parc (status=${mission.status})` }, { status: 400 })
  }
  if (mission.parc_zone_key === newZoneKey) {
    return NextResponse.json({ error: `Deja en zone ${newZoneKey}` }, { status: 400 })
  }

  // 2. Verifie que la zone cible existe et est active
  const { data: targetZone, error: zErr } = await sb
    .from('parc_zones')
    .select('key, label, depot_id, active')
    .eq('key', newZoneKey)
    .single()
  if (zErr || !targetZone) {
    return NextResponse.json({ error: `Zone ${newZoneKey} introuvable` }, { status: 400 })
  }
  if (!targetZone.active) {
    return NextResponse.json({ error: `Zone ${newZoneKey} inactive` }, { status: 400 })
  }

  // 3. Recupere nom des depots avant/apres (pour log lisible)
  const { data: oldZone } = mission.parc_zone_key ? await sb
    .from('parc_zones').select('depot_id').eq('key', mission.parc_zone_key).maybeSingle() : { data: null }

  const depotIds = [oldZone?.depot_id, targetZone.depot_id].filter(Boolean)
  const { data: depots } = depotIds.length > 0 ? await sb
    .from('depots').select('id, name').in('id', depotIds) : { data: [] }
  const depotByName = (id?: string | null) => depots?.find(d => d.id === id)?.name || '?'

  const oldDepotName = depotByName(oldZone?.depot_id)
  const newDepotName = depotByName(targetZone.depot_id)
  const oldLabel = `${oldDepotName} / Zone ${mission.parc_zone_key}` + (mission.parc_row_number != null ? ` (Rang ${mission.parc_row_number})` : '')
  const newLabel = `${newDepotName} / Zone ${newZoneKey}`

  // 4. Update mission : zone + reset position (nouvelle zone = nouvelles rangees)
  const { error: upErr } = await sb
    .from('incoming_missions')
    .update({
      parc_zone_key:   newZoneKey,
      parc_row_number: null,
      parc_slot_index: null,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', params.id)
  if (upErr) {
    return NextResponse.json({ error: `Update KO : ${upErr.message}` }, { status: 500 })
  }

  // 5. Log mission_logs (best-effort, non bloquant)
  const noteParts = [`Transfere de ${oldLabel} vers ${newLabel}`]
  if (body.reason) noteParts.push(`Raison : ${body.reason}`)
  noteParts.push(`par ${user.name || user.email || 'operateur fourriere'}`)
  await sb.from('mission_logs').insert({
    mission_id: params.id,
    action:     'parc_transfer',
    notes:      noteParts.join(' · '),
    actor_id:   user.id,
    metadata:   {
      from_zone_key:    mission.parc_zone_key,
      from_row_number:  mission.parc_row_number,
      from_slot_index:  mission.parc_slot_index,
      from_depot_id:    oldZone?.depot_id,
      from_depot_name:  oldDepotName,
      to_zone_key:      newZoneKey,
      to_depot_id:      targetZone.depot_id,
      to_depot_name:    newDepotName,
      reason:           body.reason || null,
    },
  }).then(() => {}, e => console.warn(`[transfer-parc] log KO mission=${params.id}:`, e?.message))

  return NextResponse.json({
    ok: true,
    from: oldLabel,
    to:   newLabel,
    message: `Transfert OK : ${oldLabel} → ${newLabel}`,
  })
}
