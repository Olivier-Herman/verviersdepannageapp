// src/app/api/cron/market-proposals/route.ts
//
// Cron (chaque minute) des propositions de nuit Momo Market (Olivier 30/09/2026) :
// appel au 1er départ après 2 min sans réponse, passage à la réserve 2 min plus
// tard, dispatcher prévenu si la réserve ne répond pas, propositions fermées quand
// la mission a été attribuée ou retirée. Cf lib/missions/market-proposals.ts.

import { NextRequest, NextResponse } from 'next/server'
import { tickProposals } from '@/lib/missions/market-proposals'
import { cronFailed, cronRecovered } from '@/lib/cron-alert'
import { sendNotificationToRoles } from '@/lib/notifications/send'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

async function handleGET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const stats = await tickProposals()
    await cronRecovered('market-proposals', async since => {
      await sendNotificationToRoles(['superadmin'], 'market_proposal_update', {
        title: '✅ Propositions de nuit rétablies',
        body:  `Les délais tournent de nouveau (panne depuis ${new Date(since).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })}).`,
        action_url: '/dispatch',
        data: { cron_error: 'false' },
      })
    })
    return NextResponse.json({ ok: true, ...stats })
  } catch (e: any) {
    console.error('[cron/market-proposals]', e?.message)
    // Un cron en échec doit se voir — mais une seule fois par panne, et seulement si elle dure 3 minutes.
    await cronFailed('market-proposals', String(e?.message || 'erreur'), 3 * 60_000, async () => {
      await sendNotificationToRoles(['superadmin'], 'market_proposal_update', {
        title: '⚠️ Propositions de nuit en panne',
        body:  `Les délais (appel au 1er départ, passage à la réserve) ne tournent plus depuis 3 minutes : ${String(e?.message || 'erreur').slice(0, 160)}`,
        action_url: '/dispatch',
        data: { cron_error: 'true' },
      })
    })
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}


// Les appels d'IA de ce passage sont comptés sous « cron:market-proposals » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:market-proposals' }, () => handleGET(...args))
}
