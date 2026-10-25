// src/app/api/cron/payment-advices/route.ts
//
// Lecture des avis de paiement assureurs (IMA, AWP) et mise en cache.
//
// Deux passages par jour : 5 h — les avis IMA arrivent la nuit, l'écran est
// donc à jour dès l'ouverture — et midi, pour ceux de la matinée. Entre les
// deux, Finance › Réconciliation lit `payment_advices` et s'affiche
// instantanément au lieu d'attendre Graph et Claude.
//
// Idempotent : un mail déjà lu n'est jamais rouvert. Deux passages qui se
// chevauchent produisent la même table.

import { NextResponse }       from 'next/server'
import { gardeHeureBxl } from '@/lib/cron/heure-bxl'
import { syncAdvices }        from '@/lib/advice-cache'
import { createAdminClient }  from '@/lib/supabase'
import { withAiContext } from '@/lib/ai/usage'

/**
 * Trace de passage, écrite qu'il réussisse ou qu'il échoue.
 *
 * Sans elle, impossible de distinguer « le cron ne se déclenche pas » de « il
 * se déclenche et ne trouve rien » : une lecture sans nouveauté ne touche
 * aucune ligne. On a cherché plusieurs jours pour rien. Olivier 2026-08-19.
 */
async function trace(payload: Record<string, unknown>) {
  try {
    const sb = createAdminClient()
    await sb.from('app_settings').upsert(
      { key: 'payment_advices_last_run', value: JSON.stringify({ at: new Date().toISOString(), ...payload }) },
      { onConflict: 'key' },
    )
  } catch { /* la trace ne doit jamais faire échouer le cron */ }
}

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

/** Profondeur de balayage : au-delà, un avis est de toute façon déjà rapproché. */
const MONTHS_BACK = 3

async function handleGET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - MONTHS_BACK)

  try {
    const res = await syncAdvices(since.toISOString())
    await trace({ ok: true, ...res })
    return NextResponse.json({ ok: true, at: new Date().toISOString(), ...res })
  } catch (e: any) {
    console.error('[cron payment-advices]', e?.message || e)
    await trace({ ok: false, error: String(e?.message || e).slice(0, 300) })
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}


// Les appels d'IA de ce passage sont comptés sous « cron:payment-advices » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  // Heure de Bruxelles (5 h et 12 h) malgré le changement d'heure : planifiée deux fois en UTC (25/10/2026).
  if (args[0].headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`) { const g = await gardeHeureBxl(args[0], 'payment-advices', [5, 12]); if (g) return g }
  return withAiContext({ declencheur: 'cron:payment-advices' }, () => handleGET(...args))
}
