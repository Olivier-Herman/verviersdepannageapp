// POST /api/dispatch/garage-cancellations/[id]/decide
// { decision: 'approved_total' | 'approved_billing_dpr' | 'refused', note?: string }
//
// Olivier 2026-06-02. Decision du dispatch sur une demande d annulation
// garage. Si approved_total : la mission passe en 'cancelled' + amount=0.
// Si approved_billing_dpr : la mission passe en 'completed' + amount = tarif
// DPR du garage (fallback DSP). Si refused : la mission continue normalement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function isDispatcherOrAdmin(session: any): boolean {
  const role: string = session?.user?.role || ''
  const roles: string[] = Array.isArray(session?.user?.roles) ? session.user.roles : []
  const all = [role, ...roles]
  return all.some(r => ['admin', 'superadmin', 'dispatcher'].includes(r))
}

const VALID = new Set(['approved_total', 'approved_billing_dpr', 'refused'])

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isDispatcherOrAdmin(session)) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const decision = String(body?.decision || '')
  const note     = String(body?.note     || '').trim() || null
  if (!VALID.has(decision)) return NextResponse.json({ error: 'decision invalide' }, { status: 400 })

  const sb = createAdminClient()
  const { data: cr, error } = await sb
    .from('garage_cancellation_requests')
    .select('id, mission_id, requested_by_garage_id, status')
    .eq('id', params.id)
    .maybeSingle()
  if (error || !cr) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })
  if (cr.status !== 'pending') return NextResponse.json({ error: 'Demande deja decidee' }, { status: 400 })

  const userId = (session.user as any).id
  const nowIso = new Date().toISOString()

  // Action sur la mission selon decision
  if (decision === 'approved_total') {
    await sb.from('incoming_missions')
      .update({ status: 'cancelled', amount_to_collect: 0, updated_at: nowIso })
      .eq('id', cr.mission_id)
  } else if (decision === 'approved_billing_dpr') {
    // Recup tarif DPR (fallback DSP)
    const { data: t } = await sb.from('garage_tariffs')
      .select('dsp_price, dpr_price')
      .eq('garage_partner_id', cr.requested_by_garage_id)
      .maybeSingle()
    const dprPrice = t?.dpr_price ?? t?.dsp_price ?? null
    await sb.from('incoming_missions')
      .update({
        status:            'completed',
        completed_at:      nowIso,
        amount_to_collect: dprPrice,
        updated_at:        nowIso,
      })
      .eq('id', cr.mission_id)
  }
  // si 'refused', on touche pas a la mission

  // Update la demande
  const { error: uErr } = await sb.from('garage_cancellation_requests')
    .update({
      status:             decision,
      decided_by_user_id: userId,
      decided_at:         nowIso,
      decision_note:      note,
    })
    .eq('id', params.id)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  // Notif garage : selon decision
  try {
    const { notifyGarageOfMissionEvent } = await import('@/lib/notifications/garage')
    const eventMap: Record<string, any> = {
      approved_total:       'cancellation_approved_total',
      approved_billing_dpr: 'cancellation_approved_dpr',
      refused:              'cancellation_refused',
    }
    const ev = eventMap[decision]
    if (ev) {
      const opts: any = { decisionNote: note }
      if (decision === 'approved_billing_dpr') {
        const { data: m } = await sb.from('incoming_missions').select('amount_to_collect').eq('id', cr.mission_id).maybeSingle()
        opts.amountDpr = m?.amount_to_collect ?? null
      }
      await notifyGarageOfMissionEvent(cr.mission_id, ev, opts)
    }
  } catch { /* silent */ }

  return NextResponse.json({ ok: true, decision })
}
