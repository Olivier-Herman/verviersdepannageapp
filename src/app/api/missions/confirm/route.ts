// src/app/api/missions/confirm/route.ts
// Confirme (new→dispatching ou assigned) ou refuse (new→ignored) une mission

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mission_id, action, reason } = await req.json()

  if (!mission_id || !action) {
    return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: actor } = await supabase
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()

  const now = new Date().toISOString()

  if (action === 'confirm') {
    // Vérifier si un chauffeur est déjà assigné
    const { data: mission } = await supabase
      .from('incoming_missions')
      .select('assigned_to')
      .eq('id', mission_id)
      .single()

    const newStatus = mission?.assigned_to ? 'assigned' : 'dispatching'

    await supabase
      .from('incoming_missions')
      .update({ status: newStatus, updated_at: now })
      .eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id: actor?.id || null,
      action:   'dispatched',
      notes:    `Mission confirmée par ${actor?.name || 'dispatcher'}`,
    })

    return NextResponse.json({ ok: true, status: newStatus })

  } else if (action === 'refuse') {
    await supabase
      .from('incoming_missions')
      .update({ status: 'ignored', updated_at: now })
      .eq('id', mission_id)

    await supabase.from('mission_logs').insert({
      mission_id,
      actor_id: actor?.id || null,
      action:   'cancelled',
      notes:    reason || 'Mission refusée',
    })

    return NextResponse.json({ ok: true, status: 'ignored' })
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
}
