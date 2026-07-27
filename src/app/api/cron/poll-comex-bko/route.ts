// src/app/api/cron/poll-comex-bko/route.ts
//
// Cron (toutes les 3 min) : synchronise les dossiers Touring COMEX BKO avec
// VD Soft (table touring_comex_dossiers). Interroge les comptes BKO en
// séquence. Lecture seule côté Touring (aucune validation). Olivier 2026-07-27.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { syncComexBko }      from '@/lib/touring/comex-bko-sync'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  try {
    const summary = await syncComexBko(sb)
    await sb.from('app_settings').upsert(
      { key: 'comex_bko_last_sync', value: { at: new Date().toISOString(), ...summary } },
      { onConflict: 'key' },
    ).then(() => {}, () => {})
    return NextResponse.json({ ok: true, ...summary })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'échec sync' }, { status: 502 })
  }
}
