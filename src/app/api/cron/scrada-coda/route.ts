// src/app/api/cron/scrada-coda/route.ts
//
// Chaque matin vers 6 h (Bruxelles), avant la tournée de Florent de 7 h :
// import des CODA Scrada reçus dans le journal « Scrada » de l'ERP
// (Olivier 05/10/2026, décision 7a du lot 2 : fait seul). Idempotent.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { importScradaCoda } from '@/lib/agents/scrada-coda'
import { journal } from '@/lib/agents/core'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function trace(payload: Record<string, unknown>) {
  try { await createAdminClient().from('app_settings').upsert({ key: 'scrada_coda_last_run', value: JSON.stringify({ at: new Date().toISOString(), ...payload }) }, { onConflict: 'key' }) } catch { /* jamais bloquant */ }
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const res = await importScradaCoda()
    await trace({ ok: !res.stopped, ...res })
    return NextResponse.json({ ok: !res.stopped, ...res })
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300)
    await journal({ agent: 'Florent', company: 1, action: 'import Scrada en échec', detail: msg, ok: false })
    await trace({ ok: false, error: msg })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
