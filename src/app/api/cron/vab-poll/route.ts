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

  const started = Date.now()
  try {
    const result = await runVabImport({ mode: 'send' })
    console.log(`[cron vab-poll] total=${result.total} already=${result.already} success=${result.success} failed=${result.failed}`)
    await trace({ ok: true, total: result.total, already: result.already, success: result.success, failed: result.failed, skipped: result.skipped ?? 0, ms: Date.now() - started,
      inserted: (result.results || []).filter(r => r.ok && r.action !== 'skipped').map(r => r.missionNumber) })
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[cron vab-poll]', e.message)
    await trace({ ok: false, error: e?.message || 'erreur', ms: Date.now() - started })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * Trace de passage — le cron était MUET (Olivier 26/09/2026 : mission VAB de
 * 11:17 créée à 11:30, deux cycles passés à côté sans qu'on sache si le portail
 * a refusé la connexion ou si VAB ne la listait pas encore). Même leçon que
 * vab-close-retry et payment-advices : `vab_poll_last_run` = dernier passage,
 * `vab_poll_runs` = les 24 derniers (2 h), pour lire un trou après coup.
 */
async function trace(payload: Record<string, unknown>) {
  try {
    const { createAdminClient } = await import('@/lib/supabase')
    const sb = createAdminClient()
    const entry = { at: new Date().toISOString(), ...payload }
    await sb.from('app_settings').upsert({ key: 'vab_poll_last_run', value: JSON.stringify(entry) }, { onConflict: 'key' })
    const { data } = await sb.from('app_settings').select('value').eq('key', 'vab_poll_runs').maybeSingle()
    let runs: unknown[] = []
    try { runs = JSON.parse(String((data as any)?.value || '[]')); if (!Array.isArray(runs)) runs = [] } catch { runs = [] }
    runs.push(entry)
    await sb.from('app_settings').upsert({ key: 'vab_poll_runs', value: JSON.stringify(runs.slice(-24)) }, { onConflict: 'key' })
  } catch { /* la trace ne doit jamais faire échouer le cron */ }
}
