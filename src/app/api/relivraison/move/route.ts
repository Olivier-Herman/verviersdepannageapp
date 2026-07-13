// src/app/api/relivraison/move/route.ts
//
// POST { mission_id, zone }  (zone ∈ zones de type 'relivraison', ex. K / K1)
// Déplace manuellement un véhicule en parc entre sous-parcs de relivraison —
// notamment K « Relivraison » ↔ K1 « En attente d'adresse ». Le dispatch pousse
// un véhicule en K1 tant que l'adresse n'est pas connue, puis en K.
// Accès : dispatcher / admin / superadmin / fourrière. Olivier 2026-07-13.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const roles: string[] = Array.isArray(user.roles) ? user.roles : []
  const modules: string[] = user.modules || []
  const allowed = ['dispatcher', 'admin', 'superadmin'].some(r => r === role || roles.includes(r))
    || modules.includes('fourriere')
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const missionId = String(body.mission_id || '').trim()
  const zone      = String(body.zone || '').trim()
  if (!missionId || !zone) return NextResponse.json({ error: 'mission_id et zone requis' }, { status: 400 })

  const sb = createAdminClient()

  // Zone cible = une zone de relivraison active.
  const { data: tz } = await sb
    .from('parc_zones')
    .select('key, active, zone_type')
    .eq('key', zone)
    .maybeSingle()
  if (!tz || tz.active === false || tz.zone_type !== 'relivraison') {
    return NextResponse.json({ error: `Zone ${zone} invalide (relivraison uniquement)` }, { status: 400 })
  }

  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, status, parc_zone_key, redelivery_address')
    .eq('id', missionId)
    .single()
  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (mission.status !== 'parked') {
    return NextResponse.json({ error: `Le véhicule doit être en parc (status=${mission.status}).` }, { status: 400 })
  }
  if (mission.parc_zone_key === zone) {
    return NextResponse.json({ ok: true, zone })   // déjà là, no-op
  }

  const from = mission.parc_zone_key
  const { error: upErr } = await sb
    .from('incoming_missions')
    .update({ parc_zone_key: zone, parc_row_number: null, parc_slot_index: null, updated_at: new Date().toISOString() })
    .eq('id', missionId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: missionId, actor_id: user.id, action: 'transfer_zone_relivraison',
    notes: `Déplacé ${from || '?'} → ${zone} (par ${user.name || user.email || 'dispatch'})`,
    metadata: { from_zone: from, to_zone: zone, manual: true },
  }).then(() => {}, () => {})

  // Étiquette REL uniquement si on passe en K avec une adresse (vraie relivraison).
  let labelPrinted = false
  if (zone === 'K' && mission.redelivery_address) {
    try {
      const { reprintLabelForMission } = await import('@/lib/missions/reprint-label-helper')
      const r = await reprintLabelForMission({ kind: 'uuid', value: missionId })
      labelPrinted = !!r.ok
    } catch { /* non bloquant */ }
  }

  return NextResponse.json({ ok: true, zone, label_printed: labelPrinted })
}
