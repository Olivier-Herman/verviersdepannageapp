// src/app/api/auto-dispatch/cancel/route.ts
//
// POST /api/auto-dispatch/cancel { mission_id }
//
// Stoppe manuellement la procedure auto-dispatch sans assigner de chauffeur.
// - Annule tous les dispatch_attempts_log pending de la mission
// - Repasse la mission de 'dispatching' vers 'new' (le dispatcher peut re-trigger)
// - Log l'action pour traçabilite

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role    = (session.user as any).role || ''
  const modules = (session.user as any).modules || []
  const allowed = ['admin', 'superadmin', 'dispatcher'].includes(role) || modules.includes('auto_dispatch')
  if (!allowed) return NextResponse.json({ error: 'Permission auto_dispatch requise' }, { status: 403 })

  const body = await req.json() as { mission_id?: string }
  if (!body.mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const sb = createAdminClient()
  const now = new Date().toISOString()

  // Annule toute tentative en cours
  const { data: cancelled, error: cancelErr } = await sb
    .from('dispatch_attempts_log')
    .update({ status: 'cancelled', updated_at: now })
    .eq('mission_id', body.mission_id)
    .in('status', ['pending', 'push_sent', 'call_1_sent', 'call_2_sent'])
    .select('id')
  if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 })

  // Repasse la mission en 'new' si elle etait en 'dispatching' (et non encore assignee)
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('id, status, assigned_to')
    .eq('id', body.mission_id)
    .maybeSingle()
  if (mission && mission.status === 'dispatching' && !mission.assigned_to) {
    await sb.from('incoming_missions').update({ status: 'new', updated_at: now }).eq('id', body.mission_id)
  }

  // Resoudre acteur pour le log
  const { data: actor } = await sb
    .from('users')
    .select('id')
    .eq('email', session.user.email!)
    .single()

  await sb.from('mission_logs').insert({
    mission_id: body.mission_id,
    actor_id:   actor?.id || null,
    action:     'auto_dispatch_cancelled',
    notes:      `Auto-dispatch stoppe manuellement (${cancelled?.length || 0} tentatives annulees)`,
  })

  return NextResponse.json({ ok: true, cancelled_count: cancelled?.length || 0 })
}
