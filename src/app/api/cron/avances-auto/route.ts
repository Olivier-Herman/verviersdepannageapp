// src/app/api/cron/avances-auto/route.ts — refacturation automatique des avances de fonds oubliées (Olivier 24/11/2026).
// Toutes les heures en journée de semaine. Les cas douteux et les échecs sont journalisés (visibles au bureau du jour).
import { NextResponse } from 'next/server'
import { refacturerAvancesManquantes } from '@/lib/facturation/avances-auto'
import { pausedAndLogged } from '@/lib/agents/pause'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await pausedAndLogged('vd-achats', 'Florent', 'Avances de fonds')) return NextResponse.json({ ok: true, pause: true })
  try {
    const r = await refacturerAvancesManquantes()
    try { await createAdminClient().from('app_settings').upsert({ key: 'avances_auto_last_run', value: JSON.stringify({ at: new Date().toISOString(), ok: true, n: r.length, r }) }, { onConflict: 'key' }) } catch {}
    return NextResponse.json({ ok: true, resultats: r })
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300)
    try { await createAdminClient().from('app_settings').upsert({ key: 'avances_auto_last_run', value: JSON.stringify({ at: new Date().toISOString(), ok: false, error: msg }) }, { onConflict: 'key' }) } catch {}
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
