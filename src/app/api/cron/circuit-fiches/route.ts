// src/app/api/cron/circuit-fiches/route.ts — fiches de réservation du Circuit encodées dès réception (Olivier
// 28/10/2026). Une fois par jour (le matin) ; logique et règles : lib/circuit/fiches.ts. Résumé à Olivier sur Telegram.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { traiterFiches } from '@/lib/circuit/fiches'
import { withAiContext } from '@/lib/ai/usage'
import { getBusinessText } from '@/lib/settings/business'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Pas d'activité au Circuit de décembre à février (Olivier 28/10/2026) : aucune surveillance pendant la période
// du réglage circuit_fiches_pause (« MM-JJ/MM-JJ », début inclus, fin exclue, peut enjamber le nouvel an).
async function enPause(): Promise<boolean> {
  const v = String(await getBusinessText('circuit_fiches_pause').catch(() => '') || '')
  const m = v.match(/^(\d{2}-\d{2})\s*\/\s*(\d{2}-\d{2})$/)
  if (!m) return false
  const jour = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }).slice(5)
  const [du, au] = [m[1], m[2]]
  return du <= au ? jour >= du && jour < au : jour >= du || jour < au
}

async function handleGET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await enPause()) return NextResponse.json({ ok: true, pause: true })
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
