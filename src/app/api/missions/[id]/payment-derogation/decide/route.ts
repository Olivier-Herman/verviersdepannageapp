// src/app/api/missions/[id]/payment-derogation/decide/route.ts
//
// POST : dispatcheur de garde (ou admin) decide d une derogation pending
// body : { derogation_id, decision: 'cancelled_amount' | 'adjusted' | 'refused',
//          new_amount?, note? }
//
// Effet :
//   - 'cancelled_amount' → amount_to_collect = 0 (mission cloturable)
//   - 'adjusted'         → amount_to_collect = new_amount
//   - 'refused'          → mission inchangee, chauffeur doit encaisser le total
// Dans tous les cas : status derogation → decision + notif push au chauffeur.
//
// Concurrency : si la demande n est plus pending (un autre dispatcheur a deja
// decide), retourne 409 avec l etat actuel — le client doit refresh.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification }  from '@/lib/notifications/send'

export const dynamic = 'force-dynamic'

type Decision = 'cancelled_amount' | 'adjusted' | 'refused'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin', 'dispatcher'].includes(role)) {
    return NextResponse.json({ error: 'Reserve aux dispatcheurs' }, { status: 403 })
  }

  const body = await req.json() as {
    derogation_id?: string
    decision?:      Decision
    new_amount?:    number | string
    note?:          string
  }
  if (!body.derogation_id) return NextResponse.json({ error: 'derogation_id requis' }, { status: 400 })
  if (!body.decision || !['cancelled_amount', 'adjusted', 'refused'].includes(body.decision)) {
    return NextResponse.json({ error: 'decision invalide' }, { status: 400 })
  }
  let newAmount: number | null = null
  if (body.decision === 'adjusted') {
    newAmount = typeof body.new_amount === 'string' ? parseFloat(body.new_amount) : (body.new_amount ?? null)
    if (newAmount == null || Number.isNaN(newAmount) || newAmount < 0) {
      return NextResponse.json({ error: 'new_amount valide (>= 0) requis pour adjusted' }, { status: 400 })
    }
  }

  const sb = createAdminClient()

  const { data: me } = await sb
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()
  if (!me) return NextResponse.json({ error: 'User introuvable' }, { status: 401 })

  // Lock optimiste : update uniquement si encore pending. Sinon → 409 (un autre
  // dispatcheur a deja decide). Le UPDATE conditionnel evite la race.
  const decidedAt = new Date().toISOString()
  const { data: updated, error: updErr } = await sb
    .from('payment_derogations')
    .update({
      status:        body.decision,
      new_amount:    newAmount,
      decided_by:    me.id,
      decided_at:    decidedAt,
      decision_note: (body.note || '').trim() || null,
    })
    .eq('id', body.derogation_id)
    .eq('mission_id', params.id)
    .eq('status', 'pending')  // <- race-condition guard
    .select('id, requested_by, motive, status')
    .maybeSingle()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json({ error: 'Cette demande a deja ete traitee', already_decided: true }, { status: 409 })
  }

  // Effet sur la mission
  if (body.decision === 'cancelled_amount') {
    await sb.from('incoming_missions').update({ amount_to_collect: 0, updated_at: decidedAt }).eq('id', params.id)
  } else if (body.decision === 'adjusted') {
    await sb.from('incoming_missions').update({ amount_to_collect: newAmount, updated_at: decidedAt }).eq('id', params.id)
  }
  // refused : pas d update mission

  // Notif retour chauffeur
  const labelByDecision: Record<Decision, string> = {
    cancelled_amount: '✅ Dérogation acceptée : montant annulé',
    adjusted:         `✅ Dérogation acceptée : montant ajusté à ${newAmount} €`,
    refused:          '❌ Dérogation refusée — vous devez encaisser le total prévu',
  }
  try {
    await sendNotification(updated.requested_by, 'payment_derogation_decided', {
      title:      labelByDecision[body.decision],
      body:       (body.note || '').trim() || `Décidée par ${me.name}`,
      action_url: `/mission/${params.id}`,
      mission_id: params.id,
    } as any)
  } catch (e: any) {
    console.error('[Derogation] Notif chauffeur echouee:', e.message)
  }

  // Log
  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   me.id,
    action:     'payment_derogation_decided',
    notes:      `${labelByDecision[body.decision]}${body.note ? ' — ' + body.note : ''}`,
    metadata:   { derogation_id: body.derogation_id, decision: body.decision, new_amount: newAmount },
  })

  return NextResponse.json({ ok: true, decision: body.decision, new_amount: newAmount })
}
