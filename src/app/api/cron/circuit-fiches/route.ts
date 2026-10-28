// src/app/api/cron/circuit-fiches/route.ts — fiches de réservation du Circuit encodées dès réception (Olivier
// 28/10/2026). Une fois par jour (le matin) ; logique et règles : lib/circuit/fiches.ts. Résumé à Olivier sur Telegram.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { traiterFiches } from '@/lib/circuit/fiches'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handleGET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const res = await traiterFiches()
    await createAdminClient().from('app_settings').upsert({ key: 'circuit_fiches_last_run', value: JSON.stringify({ at: new Date().toISOString(), fiches: res.length, res }) }, { onConflict: 'key' }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, fiches: res })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}

export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:circuit-fiches' }, () => handleGET(...args))
}
