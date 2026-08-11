// src/app/api/cron/axa-poll/route.ts
//
// Cron : poll go&assist (missions « à affecter ») → crée les fiches `new`. Même
// helper runAxaImport que le bouton manuel (/api/axa/import). Cf lib/axa/import.ts.
//
// Kill-switch : DISABLE_AXA_POLL=true sur Vercel pour désactiver sans redeploy
// (convention VAB/Touring). Actif par défaut.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { runAxaImport } from '@/lib/axa/import'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.DISABLE_AXA_POLL === 'true') {
    return NextResponse.json({ ok: true, disabled: true, reason: 'DISABLE_AXA_POLL=true' })
  }

  try {
    const result = await runAxaImport({ mode: 'send' })
    console.log(`[cron axa-poll] awaiting=${result.awaiting} imported=${result.imported} skipped=${result.skipped} errors=${result.errors.length}`)
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[cron axa-poll]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
