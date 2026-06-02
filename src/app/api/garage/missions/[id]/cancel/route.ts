// POST /api/garage/missions/[id]/cancel : annulation par le garage.
//
// Olivier 2026-06-02. Workflow :
//   - Si mission encore au statut 'new' (pas acceptee) → annulation directe
//     (set status='cancelled', pas besoin de l avis dispatch)
//   - Sinon → crée garage_cancellation_request status='pending'. Le dispatch
//     decide (approved_total / approved_billing_dpr / refused).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role
  if (role !== 'garage') return NextResponse.json({ error: 'Reserve garage' }, { status: 403 })

  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const body   = await req.json().catch(() => ({}))
  const reason = String(body?.reason || '').trim() || null

  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, status, requested_by_garage_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Verif acces (user lie au garage de la mission)
  const { data: link } = await sb.from('garage_user_partners')
    .select('user_id')
    .eq('user_id', userId)
    .eq('garage_partner_id', m.requested_by_garage_id || '')
    .maybeSingle()
  if (!link) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  if (['completed', 'to_invoice', 'cancelled'].includes(m.status)) {
    return NextResponse.json({ error: 'Mission deja terminee ou annulee' }, { status: 400 })
  }

  // Cas A : pas encore acceptee → annulation directe
  if (m.status === 'new') {
    await sb.from('incoming_missions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', m.id)
    // Notif email garage (confirmation annulation directe)
    try {
      const { notifyGarageOfMissionEvent } = await import('@/lib/notifications/garage')
      await notifyGarageOfMissionEvent(m.id, 'cancelled_direct')
    } catch { /* silent */ }
    return NextResponse.json({
      ok: true,
      direct: true,
      notice: 'Mission annulée. Aucun frais ne sera facturé.',
    })
  }

  // Cas B : deja acceptee → crée la demande pending
  // (eviter doublon : si une demande pending existe deja, on update juste)
  const { data: existing } = await sb.from('garage_cancellation_requests')
    .select('id')
    .eq('mission_id', m.id)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      ok: true,
      pending: true,
      notice: 'Une demande d annulation est deja en cours d examen par notre equipe.',
    })
  }

  const { error } = await sb.from('garage_cancellation_requests').insert({
    mission_id:             m.id,
    requested_by_garage_id: m.requested_by_garage_id,
    requested_by_user_id:   userId,
    reason,
    status:                 'pending',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // TODO Phase 1.7 : envoyer notif push aux dispatchers

  return NextResponse.json({
    ok: true,
    pending: true,
    notice: 'Demande d annulation envoyée à notre équipe. Vous serez notifié de la décision.',
  })
}
