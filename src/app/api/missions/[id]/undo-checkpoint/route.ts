// src/app/api/missions/[id]/undo-checkpoint/route.ts
//
// POST — SUPERADMIN uniquement : annule le DERNIER pointage d'une fiche et la
// ramène à l'étape précédente (pour rejouer/tester une étape). Revert état-driven :
// on efface le dernier horodatage posé et on remet le statut correspondant.
//
// Chaîne chauffeur : assigned → accepted → in_progress (en route → sur place) →
//   delivering (chargé) → parked / to_invoice|completed (clôture).
//
// Olivier 2026-08-07.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { assertExitAllowed } from '@/lib/missions/exit-control'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, role, roles').eq('email', session.user.email).maybeSingle()
  const roles = [(me as any)?.role, ...((me as any)?.roles || [])].filter(Boolean) as string[]
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })

  const isUuid = /^[0-9a-f-]{36}$/i.test(params.id)
  let q = sb.from('incoming_missions')
    .select('id, status, accepted_at, on_way_at, on_site_at, loaded_at, parked_at')
  q = isUuid ? q.eq('id', params.id) : q.eq('mission_number', Number(params.id))
  const { data: m } = await q.maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const now = new Date().toISOString()
  const patch: Record<string, any> = { updated_at: now }
  let undone = ''
  const st = (m as any).status

  if (st === 'to_invoice' || st === 'completed') {
    patch.status = (m as any).loaded_at ? 'delivering' : 'in_progress'
    undone = 'clôture'
  } else if (st === 'parked') {
    // Contrôle de sortie : dé-parquer une épave armée = la faire sortir. 2026-09-07.
    const gate = await assertExitAllowed(sb, (m as any).id)
    if (!gate.ok) return NextResponse.json({ error: gate.error, exit_control_blocked: true }, { status: 409 })
    patch.status = (m as any).loaded_at ? 'delivering' : 'in_progress'
    patch.parked_at = null; patch.parc_zone_key = null; patch.park_stage_name = null
    undone = 'mise en parc'
  } else if (st === 'delivering' || (m as any).loaded_at) {
    patch.status = 'in_progress'; patch.loaded_at = null
    undone = 'véhicule chargé'
  } else if (st === 'in_progress' && (m as any).on_site_at) {
    patch.on_site_at = null   // reste in_progress = en route
    undone = 'sur place'
  } else if (st === 'in_progress' && (m as any).on_way_at) {
    patch.status = 'accepted'; patch.on_way_at = null
    undone = 'en route'
  } else if (st === 'accepted') {
    patch.status = 'assigned'; patch.accepted_at = null
    undone = 'accepté'
  } else {
    return NextResponse.json({ error: `Aucun pointage à annuler (statut "${st}")` }, { status: 400 })
  }

  const { error } = await sb.from('incoming_missions').update(patch).eq('id', (m as any).id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Supprime le dernier log de pointage (tidiness).
  const CHECKPOINT_ACTIONS = ['accept', 'on_way', 'on_site', 'load_vehicle', 'deliver', 'completed', 'parked', 'park']
  const { data: lastLog } = await sb.from('mission_logs')
    .select('id').eq('mission_id', (m as any).id).in('action', CHECKPOINT_ACTIONS)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (lastLog) await sb.from('mission_logs').delete().eq('id', (lastLog as any).id).then(() => {}, () => {})

  await sb.from('mission_logs').insert({
    mission_id: (m as any).id, actor_id: (me as any)?.id, action: 'checkpoint_undone',
    notes: `Dernier pointage annulé (superadmin) : « ${undone} » → statut ${patch.status || st}.`,
    metadata: { undone, from_status: st, to_status: patch.status || st, superadmin: true },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, undone, status: patch.status || st })
}
