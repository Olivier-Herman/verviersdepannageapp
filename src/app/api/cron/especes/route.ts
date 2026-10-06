// src/app/api/cron/especes/route.ts — inventaire des espèces à remettre (toutes les 15 min).
import { NextResponse } from 'next/server'
import { syncCashInventory } from '@/lib/especes/inventory'
import { notifyMomoDue, encodeConfirmedBacklog } from '@/lib/especes/actions'
import { pausedAndLogged } from '@/lib/agents/pause'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Les notifications à Momo ne dépendent pas de l'ERP : elles partent même pendant une pause.
  const notified = await notifyMomoDue().catch(() => 0)
  // Scrada ne dépend pas de l'ERP non plus : rattrapage des confirmations pas encore encodées.
  const backlog = await encodeConfirmedBacklog().catch((e: any) => ({ encoded: 0, errors: [String(e?.message || e)] }))
  if (await pausedAndLogged('vd-achats', 'Florent', 'Espèces à remettre')) return NextResponse.json({ ok: true, pause: true })
  try {
    const r = await syncCashInventory()
    try { await createAdminClient().from('app_settings').upsert({ key: 'especes_last_run', value: JSON.stringify({ at: new Date().toISOString(), ok: true, ...r }) }, { onConflict: 'key' }) } catch {}
    return NextResponse.json({ ok: true, notified, scrada: backlog, ...r })
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300)
    try { await createAdminClient().from('app_settings').upsert({ key: 'especes_last_run', value: JSON.stringify({ at: new Date().toISOString(), ok: false, error: msg }) }, { onConflict: 'key' }) } catch {}
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
