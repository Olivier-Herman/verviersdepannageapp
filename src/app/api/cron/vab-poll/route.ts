// src/app/api/cron/vab-poll/route.ts
//
// Cron toutes les 5 min : appelle runVabImport({ mode: 'send' }) — meme helper
// que le bouton "Import VAB" manuel. Garantit un mapping unique.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { runVabImport } from '@/lib/vab/import'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Kill-switch : DISABLE_VAB_POLL=true sur Vercel pour desactiver le scraper
  // sans redeploy (utile pour demo, debug ou maintenance Towsoft).
  if (process.env.DISABLE_VAB_POLL === 'true') {
    return NextResponse.json({ ok: true, disabled: true, reason: 'DISABLE_VAB_POLL=true' })
  }

  try {
    const result = await runVabImport({ mode: 'send' })
    console.log(`[cron vab-poll] total=${result.total} already=${result.already} success=${result.success} failed=${result.failed}`)
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[cron vab-poll]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
