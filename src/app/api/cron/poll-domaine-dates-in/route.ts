// src/app/api/cron/poll-domaine-dates-in/route.ts
//
// Cron : capture des mails « Dates IN » du Domaine (SPF Finances) → pose auto de
// la date de remise Domaine sur les saisies correspondantes. Toutes les 30 min.
// Protégé par CRON_SECRET. Olivier 2026-07-29.

import { NextResponse }        from 'next/server'
import { gardeHeureBxl } from '@/lib/cron/heure-bxl'
import { createAdminClient }   from '@/lib/supabase'
import { pollDomaineDatesIn }  from '@/lib/domaine/intake'
import { withAiContext } from '@/lib/ai/usage'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function handleGET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const summary = await pollDomaineDatesIn()
    const sb = createAdminClient()
    await sb.from('app_settings').upsert(
      { key: 'domaine_dates_in_last_run', value: { at: new Date().toISOString(), ...summary } },
      { onConflict: 'key' },
    ).then(() => {}, () => {})
    return NextResponse.json({ ok: true, ...summary })
  } catch (err: any) {
    console.error('[cron poll-domaine-dates-in] KO:', err?.message)
    return NextResponse.json({ error: err?.message || 'Erreur' }, { status: 500 })
  }
}


// Les appels d'IA de ce passage sont comptés sous « cron:poll-domaine-dates-in » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  // Heure de Bruxelles (13 h) malgré le changement d'heure : planifiée deux fois en UTC (25/10/2026).
  if (args[0].headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`) { const g = await gardeHeureBxl(args[0], 'poll-domaine-dates-in', [13]); if (g) return g }
  return withAiContext({ declencheur: 'cron:poll-domaine-dates-in' }, () => handleGET(...args))
}
