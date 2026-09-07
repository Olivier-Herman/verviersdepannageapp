// src/app/api/missions/[id]/cancel/route.ts
//
// POST /api/missions/[id]/cancel { reason }
//
// Annule une fiche : status='cancelled' + motif. La fiche devient invisible dans
// l'app (les listes filtrent par statut) mais reste conservée en base. Libère la
// position parc éventuelle (pour ne pas bloquer un emplacement du plan/fourrière).
//
// Disponible : dispatcher / admin / superadmin, OU modules facturation / fourriere.

import { NextResponse }         from 'next/server'
import { getServerSession }     from 'next-auth'
import { authOptions }          from '@/lib/auth'
import { createAdminClient }    from '@/lib/supabase'
import { assertExitAllowed }   from '@/lib/missions/exit-control'
import { releaseParcAndShift }  from '@/lib/parc/release'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user    = session.user as any
  const role    = user.role || ''
  const roles: string[]   = user.roles   || [role]
  const modules: string[] = user.modules || []

  const allowedByRole   = ['admin', 'superadmin', 'dispatcher'].some(r => role === r || roles.includes(r))
  const allowedByModule = modules.includes('facturation') || modules.includes('fourriere')
  if (!allowedByRole && !allowedByModule) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { reason?: string }
  const reason = (body.reason || '').trim()
  if (!reason) {
    return NextResponse.json({ error: 'Motif requis' }, { status: 400 })
  }

  const sb  = createAdminClient()
  const now = new Date().toISOString()

  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, status, parc_zone_key')
    .eq('id', params.id)
    .single()
  if (mErr || !mission) {
    return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  }
  if (mission.status === 'cancelled') {
    return NextResponse.json({ ok: true, alreadyCancelled: true })
  }
  // Contrôle de sortie (épave gérée par un bureau d'expertise) : annuler une
  // fiche EN PARC libère la place = le véhicule sort. Olivier 2026-09-07.
  if (mission.status === 'parked') {
    const gate = await assertExitAllowed(sb, params.id)
    if (!gate.ok) return NextResponse.json({ error: gate.error, exit_control_blocked: true }, { status: 409 })
  }

  const cancelledBy = user.name || user.email || 'inconnu'

  const { error: uErr } = await sb
    .from('incoming_missions')
    .update({
      status:           'cancelled',
      cancelled_reason: reason,
      cancelled_at:     now,
      cancelled_by:     cancelledBy,
      updated_at:       now,
    })
    .eq('id', params.id)
  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 })
  }

  // Libère l'emplacement parc (et recompacte le rang) si la fiche en occupait un.
  if (mission.parc_zone_key) {
    try { await releaseParcAndShift(sb, params.id) } catch { /* best effort */ }
  }

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    action:     'cancelled',
    notes:      `Fiche annulée — motif : ${reason} (par ${cancelledBy})`,
    metadata:   { reason, cancelled_by: cancelledBy },
  })

  return NextResponse.json({ ok: true })
}
