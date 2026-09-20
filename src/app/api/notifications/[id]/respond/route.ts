// src/app/api/notifications/[id]/respond/route.ts
//
// POST /api/notifications/[id]/respond → réponse à une notification interactive
// (popup bloquant). Pour l'instant : `verification_parc` → { answers: { mission_id: 'present'|'absent' } }.
// Ne permet de répondre QU'À ses propres notifs. Olivier 2026-09-03.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { applyParcVerificationResponse } from '@/lib/missions/parc-verification'
import { decideBureauAccess } from '@/lib/expert/access'
import { decideSiabisCouvert } from '@/lib/missions/siabis-couvert-request'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  if (!userId) return NextResponse.json({ error: 'Pas d\'identite' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const answers = (body?.answers && typeof body.answers === 'object') ? body.answers : {}

  const sb = createAdminClient()
  // Accès expert : Valider / Refuser — le premier qui répond décide et ferme
  // le popup chez tous les destinataires (même request_id). 2026-09-05.
  if (body?.decisions && typeof body.decisions === 'object') {
    const { data: n } = await sb.from('notifications_log').select('id, notif_type, payload').eq('id', params.id).eq('user_id', userId).maybeSingle()
    if (n?.notif_type !== 'expert_access') return NextResponse.json({ error: 'Notification inconnue' }, { status: 404 })
    const d = n.payload?.data || {}
    const allowed = new Set((d.items || []).map((it: any) => String(it.request_id)))
    const decisions: Record<string, 'approve' | 'refuse'> = {}
    for (const [k, v] of Object.entries(body.decisions)) if (allowed.has(k) && (v === 'approve' || v === 'refuse')) decisions[k] = v
    if (Object.keys(decisions).length !== allowed.size) return NextResponse.json({ error: 'Une décision par bureau est requise.' }, { status: 400 })
    const r = await decideBureauAccess(sb, String(d.request_group || ''), decisions, userId)
    return NextResponse.json({ ok: true, results: r.results })
  }
  // Passage en Siabis couvert : { siabis_decision: 'approve' | 'refuse' } — le premier qui répond décide. 20/09/2026.
  if (body?.siabis_decision === 'approve' || body?.siabis_decision === 'refuse') {
    const r = await decideSiabisCouvert(sb, params.id, userId, body.siabis_decision)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, already: !!r.already })
  }
  // Question à l'équipe : { choice, comment } → responded_at + réponse aux demandeurs. 20/09/2026.
  if (typeof body?.choice === 'string') {
    const { data: n } = await sb.from('notifications_log').select('id, notif_type, payload, responded_at').eq('id', params.id).eq('user_id', userId).maybeSingle()
    const d = n?.payload?.data || {}
    if (!n || d.question !== true) return NextResponse.json({ error: 'Notification inconnue' }, { status: 404 })
    const choice = (d.choices || []).find((c: any) => c.key === body.choice)
    if (!choice) return NextResponse.json({ error: 'Réponse inconnue' }, { status: 400 })
    if (n.responded_at) return NextResponse.json({ ok: true, already: true })
    const comment = String(body.comment || '').trim().slice(0, 1000)
    const now = new Date().toISOString()
    const { error } = await sb.from('notifications_log')
      .update({ responded_at: now, read_at: now, payload: { ...n.payload, data: { ...d, answer: { choice: choice.key, label: choice.label, comment, at: now } } } })
      .eq('id', params.id).is('responded_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const { data: me } = await sb.from('users').select('name').eq('id', userId).maybeSingle()
    const { sendNotification } = await import('@/lib/notifications/send')
    for (const uid of (d.notify_user_ids || []) as string[]) {
      if (!uid || uid === userId) continue
      await sendNotification(uid, 'question_reponse', {
        title: `${me?.name || 'Un collègue'} a répondu : ${choice.label}`,
        body: `« ${n.payload?.title || ''} »${comment ? ` — ${comment}` : ''}`,
        data: { question_id: params.id, choice: choice.key, comment },
      })
    }
    return NextResponse.json({ ok: true })
  }
  const res = await applyParcVerificationResponse(sb, params.id, userId, answers)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, present: res.present, absent: res.absent })
}
