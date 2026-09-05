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
  if (body?.decision === 'approve' || body?.decision === 'refuse') {
    const { data: n } = await sb.from('notifications_log').select('id, notif_type, payload').eq('id', params.id).eq('user_id', userId).maybeSingle()
    const reqId = n?.payload?.data?.request_id
    if (n?.notif_type !== 'expert_access' || !reqId) return NextResponse.json({ error: 'Notification inconnue' }, { status: 404 })
    const r = await decideBureauAccess(sb, String(reqId), userId, body.decision)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json({ ok: true, status: r.status, bureau: r.bureau })
  }
  const res = await applyParcVerificationResponse(sb, params.id, userId, answers)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, present: res.present, absent: res.absent })
}
