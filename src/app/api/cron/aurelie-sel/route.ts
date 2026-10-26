// src/app/api/cron/aurelie-sel/route.ts
//
// Aurélie (sans IA) : factures SEL Peppol d'AWP / AP Solutions, chaque heure de
// 6 h à 18 h, heure de Bruxelles. Respecte la pause décidée dans le village.

import { facturationAutoSuspendue } from '@/lib/facturation/suspension'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { runAurelieSel } from '@/lib/agents/aurelie-sel'
import { pausedAndLogged } from '@/lib/agents/pause'
import { journal } from '@/lib/agents/core'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const hourBxl = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(new Date())) % 24

async function trace(payload: Record<string, unknown>) {
  try { await createAdminClient().from('app_settings').upsert({ key: 'aurelie_sel_last_run', value: JSON.stringify({ at: new Date().toISOString(), ...payload }) }, { onConflict: 'key' }) } catch { /* jamais bloquant */ }
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const h = hourBxl()
  if (h < 6 || h > 18) return NextResponse.json({ ok: true, horsPlage: h })
  // Interrupteur général de la facturation sur off (Olivier 26/10/2026 : « même l'agent ne s'occupe pas de la
  // facturation ») : Aurélie ne valide aucune facture SEL ; elles attendent la relance.
  if (await facturationAutoSuspendue(createAdminClient())) { await trace({ ok: true, suspendue: true }); return NextResponse.json({ ok: true, suspendue: true }) }
  if (await pausedAndLogged('vd-facturation', 'Aurélie', 'Factures SEL')) { await trace({ ok: true, pause: true }); return NextResponse.json({ ok: true, pause: true }) }
  try {
    const res = await runAurelieSel()
    await trace({ ok: !res.arret, ...res })
    return NextResponse.json({ ok: !res.arret, ...res })
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300)
    await journal({ agent: 'Aurélie', company: 1, action: 'factures SEL en échec', detail: msg, ok: false })
    await trace({ ok: false, error: msg })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
