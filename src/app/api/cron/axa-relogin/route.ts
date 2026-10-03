// src/app/api/cron/axa-relogin/route.ts
//
// Reconnexion automatique go&assist (Olivier 13/09/2026). Les jetons du
// portail meurent à 24 h ; on se reconnecte deux fois par jour, comme le
// portail le fait lui-même, et le poll déclenche aussi une reconnexion dès
// qu'un jeton est refusé. Résultat tracé dans app_settings.axa_relogin_last.

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { runAxaRelogin } from '@/lib/axa/relogin-run'
import { withAiContext } from '@/lib/ai/usage'

async function handleGET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const r = await runAxaRelogin('cron')
  return NextResponse.json(r, { status: r.ok ? 200 : 500 })
}


// Les appels d'IA de ce passage sont comptés sous « cron:axa-relogin » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:axa-relogin' }, () => handleGET(...args))
}
