// src/app/api/cron/market-proposals/route.ts
//
// Cron (chaque minute) des propositions de nuit Momo Market (Olivier 30/09/2026) :
// appel au 1er départ après 2 min sans réponse, passage à la réserve 2 min plus
// tard, dispatcher prévenu si la réserve ne répond pas, propositions fermées quand
// la mission a été attribuée ou retirée. Cf lib/missions/market-proposals.ts.

import { NextRequest, NextResponse } from 'next/server'
import { tickProposals } from '@/lib/missions/market-proposals'
import { createAdminClient } from '@/lib/supabase'
import { sendNotificationToRoles } from '@/lib/notifications/send'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const stats = await tickProposals()
    return NextResponse.json({ ok: true, ...stats })
  } catch (e: any) {
    console.error('[cron/market-proposals]', e?.message)
    // Un cron en échec doit se voir : notif aux superadmins, au plus une par heure.
    try {
      const sb = createAdminClient()
      const since = new Date(Date.now() - 3600_000).toISOString()
      const { data: recent } = await sb.from('notifications_log').select('id')
        .eq('notif_type', 'market_proposal_update').eq('payload->data->>cron_error', 'true').gte('created_at', since).limit(1)
      if (!recent?.length) {
        await sendNotificationToRoles(['superadmin'], 'market_proposal_update', {
          title: '⚠️ Propositions de nuit en panne',
          body:  `Les délais (appel au 1er départ, passage à la réserve) ne tournent plus : ${String(e?.message || 'erreur').slice(0, 160)}`,
          action_url: '/dispatch',
          data: { cron_error: 'true' },
        })
      }
    } catch { /* on a déjà loggé l'erreur d'origine */ }
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}
